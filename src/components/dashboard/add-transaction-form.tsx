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


const formSchema = z.object({
  symbol: z.string().min(1, "股票代码不能为空。").max(10, "股票代码过长。").toUpperCase(),
  type: z.enum(["Buy", "Sell"], { required_error: "请选择交易类型。" }),
  quantity: z.coerce.number().positive("数量必须为正数。"),
  price: z.coerce.number().positive("价格必须为正数。"),
  date: z.date({ required_error: "请选择交易日期。" }),
});

type AddTransactionFormProps = {
  onSuccess?: () => void;
};

export function AddTransactionForm({ onSuccess }: AddTransactionFormProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user } = useUser();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      symbol: "",
      type: "Buy",
      date: new Date(),
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
      const transactionData = {
        ...values,
        id: uuidv4(), //虽然 Firestore 会自动生成 ID，但在写入前生成一个有助于 optimitic updates
        userId: user.uid,
        transactionDate: values.date.toISOString(),
        total: values.quantity * values.price,
      };
      
      // The `date` property is a Date object from the form, but Firestore expects a string.
      // We are sending `transactionDate` as the ISO string, but we also need to handle the `date` property from `values`.
      // Let's remove the original `date` property to avoid conflicts.
      delete (transactionData as any).date;


      const transactionsRef = collection(
        firestore,
        "users",
        user.uid,
        "transactions"
      );
      
      // 使用非阻塞方式添加文档
      addDocumentNonBlocking(transactionsRef, transactionData);

      toast({
        title: "成功！",
        description: "您的交易已成功记录。",
      });
      
      onSuccess?.(); // Callback to close the dialog

    } catch (error) {
      console.error("Error adding transaction: ", error);
      toast({
        variant: "destructive",
        title: "保存失败",
        description: "无法保存您的交易记录，请稍后再试。",
      });
    }
  }

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
                    disabled={(date) =>
                      date > new Date() || date < new Date("1990-01-01")
                    }
                    initialFocus
                    locale={zhCN}
                  />
                </PopoverContent>
              </Popover>
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
