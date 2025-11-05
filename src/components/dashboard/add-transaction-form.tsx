
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, Copy, Tag, ArrowUpRight, ArrowDownLeft, LogIn, LogOut } from "lucide-react";
import { useFirestore, useUser } from "@/firebase";
import { addDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { collection } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { v4 as uuidv4 } from 'uuid';
import { toNyCalendarDayString, nowNyCalendarDayString, toNyHmsString, nyLocalDateTimeToUtcMillis } from '@/lib/ny-time';
import SymbolCombobox from '@/components/inputs/symbol-combobox';
import { useRef, useState, useEffect } from "react";
import { zhCN } from 'date-fns/locale';
import { ActionBadge } from "@/components/common/action-badge";
import { buildOCC } from '@/lib/options/occ';
import { Badge } from "@/components/ui/badge";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";


const formSchema = z.object({
  symbol: z.string().min(1, "代码不能为空。").max(30, "代码过长。").toUpperCase(),
  type: z.enum(["BUY", "SELL", 'SHORT', 'COVER'], { required_error: "请选择交易类型。" }),
  quantity: z.coerce.number().positive("数量必须为正数。"),
  price: z.coerce.number().positive("价格必须为正数。"),
  date: z.date({ required_error: "请选择交易日期。" }),
  time: z.string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/, "请输入形如 16:00:00 的时间。"),
});

type AddTransactionFormProps = {
  onSuccess?: () => void;
  isEditing?: boolean;
  defaultValues?: any;
};

export function AddTransactionForm({ onSuccess, isEditing = false, defaultValues }: AddTransactionFormProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user } = useUser();
  const qtyRef = useRef<HTMLInputElement>(null);
  const [assetType, setAssetType] = useState<'stock' | 'option'>('stock');

  // Option-specific state
  const [underlying, setUnderlying] = useState('');
  const [expiry, setExpiry] = useState<Date | undefined>();
  const [strike, setStrike] = useState<number | string>('');
  const [cp, setCp] = useState<'C' | 'P'>('C');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [openClose, setOpenClose] = useState<'open' | 'close'>('open');
  const { copy, copied } = useCopyToClipboard();

  const handleCopy = async () => {
    const { symbol, quantity, price, type } = form.getValues();
    let summary = '';

    if (assetType === 'stock') {
      summary = `${symbol || ''} ${type || ''} ${quantity || ''} @ ${price || ''}`.trim();
    } else { // option
      const expiryStr = expiry ? toNyCalendarDayString(expiry) : '';
      const sideStr = side === 'buy' ? '买' : '卖';
      const openCloseStr = openClose === 'open' ? '开' : '平';
      const cpStr = cp;
      
      summary = `${symbol || ''} ${openCloseStr}${sideStr} ${quantity || ''} ${expiryStr} ${strike || ''}${cpStr} @ ${price || ''}`.trim();
    }
    
    await copy(summary);
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultValues ? {
      ...defaultValues,
      date: defaultValues.transactionDate ? new Date(defaultValues.transactionDate) : new Date(),
      time: (typeof defaultValues.transactionTimestamp === 'number')
        ? toNyHmsString(defaultValues.transactionTimestamp)
        : "16:00:00",
    } : {
      symbol: "",
      type: "BUY",
      // 以“此刻”的纽约时间作为默认值
      date: new Date(),                 // 日期后续用 toNyCalendarDayString 解释为“纽约日”，安全
      time: toNyHmsString(new Date()),  // 纽约时区下的 HH:mm:ss
    },
  });

  // Effect to build OCC and auto-fill symbol
  useEffect(() => {
    if (assetType === 'option' && underlying && expiry && strike !== '' && !isNaN(Number(strike))) {
      try {
        const builtOcc = buildOCC({
          underlying,
          expiry,
          cp,
          strike: Number(strike),
        });
        form.setValue('symbol', builtOcc, { shouldValidate: true, shouldDirty: true });
      } catch {
        form.setValue('symbol', '无效的期权参数');
      }
    } else if (assetType === 'option') {
      form.setValue('symbol', '');
    }
  }, [assetType, underlying, expiry, strike, cp, form]);

  // Effect to map option actions to form.type
  useEffect(() => {
    if (assetType !== 'option') return;

    const mapToType = () => {
      if (side === 'buy' && openClose === 'open') return 'BUY';   // BTO
      if (side === 'sell' && openClose === 'open') return 'SHORT'; // STO
      if (side === 'sell' && openClose === 'close') return 'SELL';  // STC
      if (side === 'buy' && openClose === 'close') return 'COVER'; // BTC
      return 'BUY'; // Default
    };

    form.setValue('type', mapToType(), { shouldValidate: true });
  }, [assetType, side, openClose, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    // Failsafe for option data
    if (assetType === 'option') {
      if (!underlying || !expiry || strike === '' || isNaN(Number(strike))) {
        toast({ variant: "destructive", title: "错误", description: "期权参数不完整，无法提交。" });
        return;
      }
      values.symbol = buildOCC({ underlying, expiry, cp, strike: Number(strike) });
      values.type = form.getValues('type'); // Ensure latest type is used
    }

    if (!user || !firestore) {
      toast({
        variant: "destructive",
        title: "错误",
        description: "用户未登录或数据库连接失败。",
      });
      return;
    }

    try {
      const originalDate = values.date instanceof Date ? values.date : new Date(values.date);
      if (isNaN(originalDate.getTime())) {
        throw new Error('[add-transaction-form] Invalid date input');
      }

      const yyyyMmDdNy = toNyCalendarDayString(originalDate); // 日期仍用 NY 日历
      const transactionTimestamp = nyLocalDateTimeToUtcMillis(yyyyMmDdNy, values.time);
      const transactionDate = new Date(transactionTimestamp).toISOString();
      const transactionDateNy = toNyCalendarDayString(transactionTimestamp);

      const transactionData = {
        ...values,
        id: defaultValues?.id || uuidv4(),
        userId: user.uid,
        transactionDate,       // 用从 UTC 毫秒反推的 ISO
        transactionDateNy,     // 由时间戳再求 NY 日期，避免边界误差
        transactionTimestamp,
        total: values.quantity * values.price,
      };
      delete (transactionData as any).date;
      delete (transactionData as any).time;
      
      const transactionsRef = collection(
        firestore,
        "users",
        user.uid,
        "transactions"
      );
      
      addDocumentNonBlocking(transactionsRef, transactionData);

      toast({
        title: "成功！",
        description: `您的交易已成功${isEditing ? '更新' : '记录'}。`,
      });
      
      onSuccess?.();

    } catch (error) {
      console.error(`Error ${isEditing ? 'updating' : 'adding'} transaction: `, error);
      toast({
        variant: "destructive",
        title: `保存失败`,
        description: `无法${isEditing ? '更新' : '保存'}您的交易记录，请稍后再试。`,
      });
    }
  }

  const nyTodayStr = nowNyCalendarDayString();   // 'YYYY-MM-DD' in NY
  const minDateLocal = new Date(1990, 0, 1);     // 安全的数值构造

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="flex items-center justify-end gap-2 -mb-4 -mt-4">
            <Button variant="ghost" size="icon" type="button" onClick={handleCopy} title="复制摘要">
                <Copy className="h-4 w-4" />
            </Button>
            {copied && <span className="text-xs text-muted-foreground animate-pulse">已复制</span>}
        </div>
        <FormItem className="space-y-3">
          <FormLabel>资产类型</FormLabel>
          <FormControl>
            <RadioGroup
              value={assetType}
              onValueChange={(v) => setAssetType(v as 'stock' | 'option')}
              className="flex flex-row space-x-4"
            >
              <FormItem className="flex items-center space-x-2 space-y-0">
                <FormControl>
                  <RadioGroupItem value="stock" id="stock" />
                </FormControl>
                <label htmlFor="stock" className="cursor-pointer">
                  <Badge className="bg-slate-700 text-white gap-1 px-3 py-1 rounded-full">
                    <Tag className="w-3.5 h-3.5" />
                    股票
                  </Badge>
                </label>
              </FormItem>
              <FormItem className="flex items-center space-x-2 space-y-0">
                <FormControl>
                  <RadioGroupItem value="option" id="option" />
                </FormControl>
                <label htmlFor="option" className="cursor-pointer">
                  <Badge className="bg-orange-600 text-white gap-1 px-3 py-1 rounded-full">
                    <Tag className="w-3.5 h-3.5" />
                    期权
                  </Badge>
                </label>
              </FormItem>
            </RadioGroup>
          </FormControl>
        </FormItem>

        {assetType === 'option' && (
          <div className="space-y-6 p-4 border rounded-md bg-emerald-100/30 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormItem className="md:col-span-1">
                  <FormLabel>标的</FormLabel>
                  <FormControl>
                    <Input placeholder="AAPL" value={underlying} onChange={e => setUnderlying(e.target.value.toUpperCase())} />
                  </FormControl>
                </FormItem>
                <FormItem className="md:col-span-1">
                  <FormLabel>到期日</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !expiry && "text-muted-foreground")}>
                          {expiry ? toNyCalendarDayString(expiry) : <span>选择日期</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={expiry} onSelect={setExpiry} initialFocus locale={zhCN} />
                    </PopoverContent>
                  </Popover>
                </FormItem>
                <FormItem className="md:col-span-1">
                  <FormLabel>行权价</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="200" value={strike} onChange={e => setStrike(e.target.value)} />
                  </FormControl>
                </FormItem>
            </div>
            <FormItem className="space-y-3">
              <FormLabel>类型</FormLabel>
              <FormControl>
                <RadioGroup value={cp} onValueChange={(v) => setCp(v as 'C' | 'P')} className="flex flex-row space-x-4">
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl><RadioGroupItem value="C" id="C" /></FormControl>
                    <label htmlFor="C" className="cursor-pointer">
                      <Badge className="bg-emerald-600 text-white gap-1 px-3 py-1 rounded-full">
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        Call
                      </Badge>
                    </label>
                  </FormItem>
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl><RadioGroupItem value="P" id="P" /></FormControl>
                    <label htmlFor="P" className="cursor-pointer">
                      <Badge className="bg-violet-600 text-white gap-1 px-3 py-1 rounded-full">
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                        Put
                      </Badge>
                    </label>
                  </FormItem>
                </RadioGroup>
              </FormControl>
            </FormItem>
          </div>
        )}

        <FormField
          control={form.control}
          name="symbol"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{assetType === 'stock' ? '股票代码' : '期权代码 (OCC, 自动生成)'}</FormLabel>
              <FormControl>
                {assetType === 'stock' ? (
                  <SymbolCombobox
                    value={field.value ?? ''}
                    onChange={(v) => field.onChange(v)}
                    placeholder="输入代码/中文/英文查找"
                    onSelected={() => qtyRef.current?.focus()}
                  />
                ) : (
                  <Input readOnly {...field} placeholder="由上方期权要素自动生成" />
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>交易类型</FormLabel>
              {assetType === 'stock' ? (
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    className="grid grid-cols-2 gap-4"
                  >
                    {["BUY", "SELL", "SHORT", "COVER"].map((type) => (
                      <FormItem key={type} className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value={type} id={`stock-${type}`} />
                        </FormControl>
                        <label htmlFor={`stock-${type}`} className="flex items-center gap-2 font-normal cursor-pointer">
                          <ActionBadge opKind={type as any} />
                        </label>
                      </FormItem>
                    ))}
                  </RadioGroup>
                </FormControl>
              ) : (
                <div className="p-4 border rounded-md bg-emerald-100/30 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormItem>
                      <FormLabel>动作</FormLabel>
                      <RadioGroup value={side} onValueChange={(v) => setSide(v as 'buy' | 'sell')} className="flex flex-row space-x-4 pt-2">
                        <FormItem className="flex items-center space-x-2 space-y-0">
                          <FormControl><RadioGroupItem value="buy" id="buy" /></FormControl>
                          <label htmlFor="buy" className="cursor-pointer font-normal">买</label>
                        </FormItem>
                        <FormItem className="flex items-center space-x-2 space-y-0">
                          <FormControl><RadioGroupItem value="sell" id="sell" /></FormControl>
                          <label htmlFor="sell" className="cursor-pointer font-normal">卖</label>
                        </FormItem>
                      </RadioGroup>
                      <FormDescription className="mt-2">将记为：</FormDescription>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <ActionBadge opKind={(side === 'buy' ? 'BUY' : 'SELL') as any} />
                      </div>
                    </FormItem>
                    <FormItem>
                      <FormLabel>开/平</FormLabel>
                      <RadioGroup
                        value={openClose}
                        onValueChange={(v) => setOpenClose(v as 'open' | 'close')}
                        className="flex flex-row space-x-4 pt-2"
                      >
                        <FormItem className="flex items-center space-x-2 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="open" id="open" />
                          </FormControl>
                          <label htmlFor="open" className="cursor-pointer font-normal">开仓</label>
                        </FormItem>
                        <FormItem className="flex items-center space-x-2 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="close" id="close" />
                          </FormControl>
                          <label htmlFor="close" className="cursor-pointer font-normal">平仓</label>
                        </FormItem>
                      </RadioGroup>
                      <FormDescription className="mt-2">将记为：</FormDescription>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {openClose === 'open' ? (
                          <Badge className="bg-sky-600 text-white gap-1 px-3 py-1 rounded-full">
                            <LogIn className="w-3.5 h-3.5" />
                            开仓
                          </Badge>
                        ) : (
                          <Badge className="bg-sky-700 text-white gap-1 px-3 py-1 rounded-full">
                            <LogOut className="w-3.5 h-3.5" />
                            平仓
                          </Badge>
                        )}
                      </div>
                    </FormItem>
                  </div>
                </div>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{assetType === 'stock' ? '数量 (股)' : '数量 (合约)'}</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="100" {...field} ref={qtyRef} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>价格 (每份)</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="150.25" step="0.01" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>交易日期</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        toNyCalendarDayString(field.value)
                      ) : (
                        <span>选择一个日期</span>
                      )}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => {
                      if (!date) return false;
                      const dNy = toNyCalendarDayString(date);
                      return dNy > nyTodayStr || date < minDateLocal;
                    }}
                    initialFocus
                    locale={zhCN}
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="time"
          render={({ field }) => (
            <FormItem>
              <FormLabel>时间</FormLabel>
              <FormControl>
                <Input placeholder="16:00:00" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "正在保存..." : "保存交易"}
        </Button>
      </form>
    </Form>
  );
}

    
