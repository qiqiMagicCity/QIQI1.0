"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "../ui/button";
import { Calendar as CalendarIcon, ListFilter } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { addDays, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useCollection, useUser, useFirestore, useMemoFirebase } from "@/firebase";
import type { Transaction } from "@/lib/data";
import { collection, query, where, orderBy } from "firebase/firestore";

export function TransactionHistory() {
  const [date, setDate] = useState<DateRange | undefined>({
    from: new Date(2023, 8, 1),
    to: addDays(new Date(2023, 9, 26), 0),
  });

  const firestore = useFirestore();
  const { user } = useUser();

  const transactionsQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    const coll = collection(firestore, 'users', user.uid, 'transactions');
    // We can add filtering and ordering here in the future
    return query(coll, orderBy("date", "desc"));
  }, [user, firestore]);

  const { data: transactions, isLoading, error } = useCollection<Transaction>(transactionsQuery);

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    if (!date?.from) return transactions;

    return transactions.filter(transaction => {
      const transactionDate = new Date(transaction.date);
      const from = date.from!;
      const to = date.to ? addDays(date.to, 1) : addDays(from, 1); // Make 'to' inclusive
      return transactionDate >= from && transactionDate < to;
    });
  }, [transactions, date]);

  return (
    <section id="history" className="scroll-mt-20">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle>交易历史</CardTitle>
            <CardDescription>所有过去交易的详细记录。</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1">
                  <ListFilter className="h-3.5 w-3.5" />
                  <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                    过滤
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>按类型筛选</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked>
                  买入
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked>
                  卖出
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant={"outline"}
                  size="sm"
                  className={cn(
                    "h-8 w-full md:w-[240px] justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {date?.from ? (
                    date.to ? (
                      <>
                        {format(date.from, "LLL dd, y", { locale: zhCN })} -{" "}
                        {format(date.to, "LLL dd, y", { locale: zhCN })}
                      </>
                    ) : (
                      format(date.from, "LLL dd, y", { locale: zhCN })
                    )
                  ) : (
                    <span>选择一个日期</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={date?.from}
                  selected={date}
                  onSelect={setDate}
                  numberOfMonths={2}
                  locale={zhCN}
                />
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative w-full overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>股票</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">价格</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">总计</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center">
                      正在加载交易记录...
                    </TableCell>
                  </TableRow>
                )}
                {error && (
                   <TableRow>
                    <TableCell colSpan={6} className="text-center text-destructive">
                      加载失败: {error.message}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !error && filteredTransactions.length === 0 && (
                   <TableRow>
                    <TableCell colSpan={6} className="text-center">
                      在此日期范围内未找到任何交易。
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filteredTransactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="whitespace-nowrap">{new Date(transaction.date).toLocaleDateString('zh-CN')}</TableCell>
                    <TableCell className="font-medium">{transaction.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={transaction.type === 'Buy' ? 'default' : 'destructive'}>
                          {transaction.type === 'Buy' ? '买入' : '卖出'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">${transaction.price.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{transaction.quantity}</TableCell>
                    <TableCell className="text-right">${transaction.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
