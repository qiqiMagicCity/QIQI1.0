'use client';

import React from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from '@/lib/utils';
import { ActionBadge } from '@/components/common/action-badge';

export interface SymbolTransactionRow {
    id: string;
    date: string;
    weekday: string;
    direction: 'Buy' | 'Sell';
    unitPrice: number;
    orderAmount: number;
}

interface SymbolTransactionsTableProps {
    data: SymbolTransactionRow[];
}

export function SymbolTransactionsTable({ data }: SymbolTransactionsTableProps) {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center gap-2">
                <div className="h-4 w-1 bg-emerald-500 rounded-full" />
                <h3 className="font-bold text-slate-200">交易明细</h3>
            </div>

            <div className="overflow-x-auto">
                <Table>
                    <TableHeader className="bg-slate-900/50">
                        <TableRow className="hover:bg-transparent border-slate-800">
                            <TableHead className="w-[50px] text-slate-400 font-medium">#</TableHead>
                            <TableHead className="text-slate-400 font-medium">日期</TableHead>
                            <TableHead className="text-slate-400 font-medium text-center">操作</TableHead>
                            <TableHead className="text-slate-400 font-medium text-right">单价</TableHead>
                            <TableHead className="text-slate-400 font-medium text-right">金额</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.map((row, index) => (
                            <TableRow
                                key={row.id}
                                className="border-slate-800/50 hover:bg-slate-900/30 transition-colors"
                            >
                                <TableCell className="font-mono text-slate-500 text-xs">
                                    {index + 1}
                                </TableCell>
                                <TableCell className="font-mono text-slate-300">
                                    <div className="flex flex-col">
                                        <span className="font-bold">{row.date}</span>
                                        <span className="text-xs text-slate-500">{row.weekday}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-center">
                                    <ActionBadge opKind={row.direction.toUpperCase() as any} />
                                </TableCell>
                                <TableCell className="text-right font-mono text-slate-300">
                                    {row.unitPrice.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-slate-300">
                                    {row.orderAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>
                            </TableRow>
                        ))}
                        {data.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                                    暂无交易记录
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
