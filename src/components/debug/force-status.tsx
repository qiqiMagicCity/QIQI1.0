"use client"

import { useEffect, useState } from "react"
import { useFirestore } from "@/firebase"
import { doc, onSnapshot } from "firebase/firestore"
import { Progress } from "@/components/ui/progress"
import { Loader2 } from "lucide-react"

interface BackfillStatus {
    isActive: boolean
    mode: 'stock' | 'option' | 'done'
    current: number
    total: number
    progressPercent: number
    currentSymbol: string
    totalFixed: number
    lastFixed: string
}

export function ForceVisibleStatus() {
    const firestore = useFirestore()
    const [status, setStatus] = useState<BackfillStatus | null>(null)

    useEffect(() => {
        if (!firestore) return

        const unsub = onSnapshot(doc(firestore, "system", "backfill_status"), (doc) => {
            if (doc.exists()) {
                setStatus(doc.data() as BackfillStatus)
            }
        })
        return () => unsub()
    }, [firestore])

    if (!status) return null

    // 如果任务完成了且不想看了，可以点击隐藏（或者是添加个X）
    if (status.mode === 'done' && !status.isActive) {
        // Optionally hide after done, but for now let's keep it visible so user KNOWS it finished
    }

    return (
        <div className="w-full bg-amber-100 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 p-4 mb-4 animate-in slide-in-from-top-4">
            <div className="container mx-auto max-w-5xl flex flex-col md:flex-row items-center gap-4">

                <div className="flex items-center gap-3">
                    <Loader2 className={`h-5 w-5 ${status.isActive ? 'animate-spin text-amber-600' : 'text-green-600'}`} />
                    <div className="flex flex-col">
                        <span className="font-bold text-lg text-amber-900 dark:text-amber-100">
                            {status.isActive ? '正在进行历史数据补全...' : '✅ 历史数据补全已完成'}
                        </span>
                        <span className="text-sm text-amber-800/80 dark:text-amber-200/80 font-mono">
                            当前处理: {status.currentSymbol} ({status.current}/{status.total})
                        </span>
                    </div>
                </div>

                <div className="flex-1 w-full md:w-auto">
                    <Progress value={status.progressPercent} className="h-4 w-full bg-amber-200 dark:bg-amber-800" />
                </div>

                <div className="text-right text-sm font-mono text-amber-900 dark:text-amber-100 min-w-[150px]">
                    <div>已修复: <strong>{status.totalFixed}</strong> 条</div>
                    <div className="text-xs opacity-75 truncate max-w-[200px]">{status.lastFixed}</div>
                </div>
            </div>
        </div>
    )
}
