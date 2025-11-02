
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
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useFirestore, useUser } from "@/firebase";
import { addDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { collection } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { v4 as uuidv4 } from 'uuid';
import { toNyCalendarDayString, nowNyCalendarDayString, toNyHmsString, nyLocalDateTimeToUtcMillis } from '@/lib/ny-time';


const formSchema = z.object({
  symbol: z.string().min(1, "股票代码不能为空。").max(10, "股票代码过长。").toUpperCase(),
  type: z.enum(["Buy", "Sell", "Short Sell", "Short Cover"], { required_error: "请选择交易类型。" }),
  quantity: z.coerce.number().positive("数量必须为正数。"),
  price: z.coerce.number().positive("价格必须为正数。"),
  date: z.date({ required_error: "请选择交易日期。" }),
  time: z.string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/, "请输入形如 16:00:00 的时间（纽约时区）。"),
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
      type: "Buy",
      date: new Date(),
      time: "16:00:00",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
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
        <FormField
          control={form.control}
          name="symbol"
          render={({ field }) => (
            <FormItem>
              <FormLabel>股票代码</FormLabel>
              <FormControl>
                <Input placeholder="例如：AAPL" {...field} />
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
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="flex flex-row space-x-4"
                >
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl>
                      <RadioGroupItem value="Buy" />
                    </FormControl>
                    <FormLabel className="font-normal">买入</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl>
                      <RadioGroupItem value="Sell" />
                    </FormControl>
                    <FormLabel className="font-normal">卖出</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl>
                      <RadioGroupItem value="Short Sell" />
                    </FormControl>
                    <FormLabel className="font-normal">卖空</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl>
                      <RadioGroupItem value="Short Cover" />
                    </FormControl>
                    <FormLabel className="font-normal">卖空补回</FormLabel>
                  </FormItem>
                </RadioGroup>
              </FormControl>
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
                <FormLabel>数量 (股)</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="100" {...field} />
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
                <FormLabel>价格 (美元)</FormLabel>
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
                        format(field.value, "PPP", { locale: zhCN })
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
              <FormLabel>时间 (纽约)</FormLabel>
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

    
