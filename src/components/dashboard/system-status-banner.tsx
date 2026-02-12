"use client"

import { useEffect, useState } from "react"
import { useFirestore } from "@/firebase"
import { doc, onSnapshot } from "firebase/firestore"
import { Progress } from "@/components/ui/progress"
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react"

interface BackfillStatus {
    isActive: boolean
    mode: 'stock' | 'option' | 'done'
    current: number
    total: number
    progressPercent: number
    currentSymbol: string
    totalFixed: number
    lastFixed: string
    updatedAt: any
}

export function SystemStatusBanner() {
    const firestore = useFirestore()
    const [status, setStatus] = useState<BackfillStatus | null>(null)
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (!firestore) return

        const unsub = onSnapshot(doc(firestore, "system", "backfill_status"), (doc) => {
            if (doc.exists()) {
                const data = doc.data() as BackfillStatus
                setStatus(data)
                // 简化逻辑：只要 isActive 就显示，或者是刚完成状态
                if (data.isActive) {
                    setVisible(true)
                } else if (data.mode === 'done') {
                    // 完成后保留一些时间
                    setVisible(true)
                } else {
                    setVisible(false)
                }
            }
        })

        return () => unsub()
    }, [firestore])

    // 强制显示：如果状态存在且可见
    if (!visible || !status) return null

    // 使用 fixed 定位确保永远可见 (z-index 50)
    return (
        <div className="fixed top-14 right-4 z-50 w-auto max-w-md animate-in slide-in-from-top-2 fade-in duration-300 pointer-events-none">
            <div className="bg-background/95 backdrop-blur-md shadow-lg border border-border/50 rounded-lg p-3 pointer-events-auto">

                {/* 状态图标 */}
                <div className="flex items-center gap-2 min-w-[120px]">
                    {status.mode === 'done' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 animate-pulse" />
                    ) : (
                        <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    )}
                    <span className="font-semibold text-foreground/90">
                        {status.mode === 'done' ? '修复完成' :
                            status.mode === 'stock' ? '正在修复历史股票' : '正在修复期权数据'}
                    </span>
                </div>

                {/* 中间去除原进度条，移至下方独立块 */}

                {/* 详情 */}
                <div className="hidden md:flex flex-col text-[10px] text-muted-foreground ml-auto text-right">
                    <div>已修复数据点: <span className="text-foreground font-mono">{status.totalFixed}</span></div>
                    <div className="truncate max-w-[200px]">最新: {status.lastFixed}</div>
                </div>
            </div>
            {/* 包含进度信息 */}
            <div className="bg-background/95 backdrop-blur-md shadow-lg border border-border/50 rounded-lg p-3 pointer-events-auto mt-2">
                <div className="flex flex-col gap-1 items-start">
                    <div className="flex justify-between w-full text-muted-foreground text-[10px]">
                        <span>{status.currentSymbol}</span>
                        <span>{status.current} / {status.total}</span>
                    </div>
                    <Progress value={status.progressPercent} className="h-1.5 w-full bg-secondary" />
                </div>
            </div>
        </div>
    )
}
