'use client';

import { useState } from 'react';
import { collection } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

import { useFirestore, useUser } from '@/firebase';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';

import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// 单条解析结果类型（ParsedTrade，已按 NY 交易日 + 序号生成时间）
type ParsedTrade = {
  dateNy: string;              // 纽约交易日 YYYY-MM-DD
  time: string;                // 人类可读时间 HH:mm:ss（从 10:00:00 起每条 +1 分钟）
  symbol: string;              // 标的代码
  side: 'BUY' | 'SELL' | 'SHORT' | 'COVER'; // 方向
  quantity: number;            // 数量（始终为正数）
  price: number;               // 单价
  transactionTimestamp: number;// 该笔交易的 UTC 时间戳（毫秒）
};

/**
 * 简单把“纽约本地日期 + 时分”转换成 UTC 毫秒。
 * 近似按 NY=UTC-5 处理（不区分夏令时），
 * 由于我们只从 10:00 起生成时间，这个近似不会跨日，足够用于历史导入。
 */
function nyLocalToUtcMillis(dateNy: string, hour: number, minute: number): number {
  const [y, m, d] = dateNy.split('-').map((s) => parseInt(s, 10));
  // 纽约大约比 UTC 慢 5 小时，所以这里 +5 变成 UTC 时间
  const utcHour = hour + 5;
  return Date.UTC(y, m - 1, d, utcHour, minute, 0);
}

/**
 * 从批量文本解析出交易列表。
 * 文本格式示例：
 *
 * 2025-10-24
 * SELL-777-USO-73.8201
 * BUY-1000-UMAC-13.65
 * SELL-1000-UMAC-14.065
 *
 * 规则：
 * - 日期行：YYYY-MM-DD
 * - 交易行：SIDE-QUANTITY-SYMBOL-PRICE
 *   例如：SELL-777-USO-73.8201 / BUY-1000-UMAC-13.65
 * - 同一天内第一条交易从 10:00:00 开始，每条 +1 分钟。
 */
function parseBulkText(raw: string): ParsedTrade[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const trades: ParsedTrade[] = [];
  let currentDate: string | null = null;
  let indexInDay = 0; // 当天内第几笔，从 0 开始

  for (const line of lines) {
    // 日期行：YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(line)) {
      currentDate = line;
      indexInDay = 0;
      continue;
    }

    if (!currentDate) {
      // 还没遇到日期行就出现交易行 → 跳过
      continue;
    }

    // 尝试两种格式：
    // 1. 标准格式：SIDE-QUANTITY-SYMBOL-PRICE (e.g. SELL-777-USO-73.8201)
    // 2. 用户自定义格式：PRICE-SYMBOL-ACTION-QUANTITY (e.g. 108.565 OKLO PUT 333)
    // 分隔符可能是空格或连字符

    // 统一将连字符替换为空格，方便 split
    const normalizedLine = line.replace(/-/g, ' ');
    const parts = normalizedLine.split(/\s+/).filter(Boolean);

    if (parts.length !== 4) {
      continue;
    }

    let side: 'BUY' | 'SELL' | 'SHORT' | 'COVER' | null = null;
    let quantity = 0;
    let symbol = '';
    let price = 0;

    // 尝试解析为格式 1: SIDE QTY SYMBOL PRICE
    const f1Side = parts[0].toUpperCase();
    if (['BUY', 'SELL', 'SHORT', 'COVER'].includes(f1Side)) {
      const q = Number(parts[1]);
      const p = Number(parts[3]);
      if (Number.isFinite(q) && Number.isFinite(p)) {
        side = f1Side as any;
        quantity = Math.abs(q); // 数量始终为正
        symbol = parts[2].toUpperCase();
        price = p;
      }
    }

    // 如果格式 1 没匹配上，尝试格式 2: PRICE SYMBOL ACTION QTY
    if (!side) {
      const f2Price = Number(parts[0]);
      const f2Action = parts[2].toUpperCase();
      const f2Qty = Number(parts[3]);

      if (Number.isFinite(f2Price) && Number.isFinite(f2Qty)) {
        // 映射 Action
        if (f2Action === 'BUY') side = 'BUY';
        else if (f2Action === 'SELL') side = 'SELL';
        else if (f2Action === 'PUT') side = 'SHORT'; // PUT -> SHORT (卖空)
        else if (f2Action === 'COVER') side = 'COVER'; // COVER -> COVER (补回)
        else if (f2Action === 'SHORT') side = 'SHORT';

        if (side) {
          quantity = Math.abs(f2Qty);
          symbol = parts[1].toUpperCase();
          price = f2Price;
        }
      }
    }

    if (!side) {
      // 无法识别的行
      continue;
    }

    // 生成纽约本地时间：从 10:00 开始，每一条 +1 分钟
    const baseHour = 10;
    const totalMinutes = indexInDay;
    const hh = baseHour + Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    const hhStr = String(hh).padStart(2, '0');
    const mmStr = String(mm).padStart(2, '0');
    const timeStr = `${hhStr}:${mmStr}:00`;

    const tsMillis = nyLocalToUtcMillis(currentDate, hh, mm);

    trades.push({
      dateNy: currentDate,
      time: timeStr,
      symbol,
      side,
      quantity,
      price,
      transactionTimestamp: tsMillis,
    });

    indexInDay++;
  }

  return trades;
}

export function BulkAddTransactionForm({ onSuccess }: { onSuccess?: () => void }) {
  const { user } = useUser();
  const firestore = useFirestore();

  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedTrade[]>([]);
  const [parseMessage, setParseMessage] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 防呆设计：防止重复提交
  const [lastSubmittedText, setLastSubmittedText] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successCount, setSuccessCount] = useState(0);

  const handleParse = () => {
    setSubmitMessage(null);
    const trades = parseBulkText(rawText);
    setParsed(trades);

    if (trades.length === 0) {
      setParseMessage('未解析出任何有效交易，请检查文本格式。');
    } else {
      setParseMessage(`已解析出 ${trades.length} 条交易记录，请确认后再提交。`);
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      setSubmitMessage('当前未登录，无法写入交易记录。');
      return;
    }
    if (parsed.length === 0) {
      setSubmitMessage('没有可提交的交易记录，请先解析文本。');
      return;
    }

    // 防呆检查：如果当前文本和上次提交的一样，且上次是成功的，则阻止
    if (rawText === lastSubmittedText) {
      setSubmitMessage('检测到重复提交！该文本已在刚才提交过，请勿重复操作。');
      return;
    }

    setSubmitting(true);
    setSubmitMessage(null);

    try {
      const txCollection = collection(firestore, 'users', user.uid, 'transactions');

      let success = 0;

      for (const t of parsed) {
        const transactionDate = new Date(t.transactionTimestamp).toISOString();

        const payload = {
          // —— 与单笔 AddTransactionForm 对齐的核心字段 ——
          symbol: t.symbol,
          type: t.side, // 'BUY' / 'SELL' / 'SHORT' / 'COVER'
          quantity: t.quantity,
          price: t.price,
          total: t.quantity * t.price,
          userId: user.uid,

          transactionTimestamp: t.transactionTimestamp,
          transactionDate,        // ISO 字符串
          transactionDateNy: t.dateNy, // 纽约交易日 YYYY-MM-DD

          assetType: 'stock' as const,
          multiplier: 1,

          // 辅助字段
          id: uuidv4(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // non-blocking 写入 Firestore
        await addDocumentNonBlocking(txCollection, payload);
        success++;
      }

      // 提交成功后记录
      setLastSubmittedText(rawText);
      setSuccessCount(success);
      setShowSuccessDialog(true);

    } catch (err) {
      console.error('批量导入交易失败', err);
      setSubmitMessage('批量导入过程中出现错误，请查看控制台日志。');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuccessConfirm = () => {
    setShowSuccessDialog(false);
    // 清空表单或关闭窗口
    setRawText('');
    setParsed([]);
    setLastSubmittedText(null);
    if (onSuccess) {
      onSuccess();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        在下方粘贴按日期分组的交易文本，例如：
        <br />
        <code className="block text-xs mt-1">
          2025-10-24
          <br />
          SELL-777-USO-73.8201
          <br />
          BUY-1000-UMAC-13.65
          <br />
          SELL-1000-UMAC-14.065
        </code>
        <span className="block mt-1">
          系统会按每一天从 10:00:00 开始，每条交易自动顺延 1 分钟。
        </span>
      </p>

      <Textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        className="min-h-[200px] font-mono text-xs"
        placeholder={`2025-11-12
108.565 OKLO PUT 333
97.87 UAL SELL-250
98.5311-UAL-BUY-250`}
      />

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={handleParse}>
          解析文本
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || parsed.length === 0}
        >
          {submitting ? '批量导入中…' : '批量提交到交易记录'}
        </Button>
      </div>

      {parseMessage && (
        <p className="text-xs text-muted-foreground whitespace-pre-line">
          {parseMessage}
        </p>
      )}

      {parsed.length > 0 && (
        <div className="border rounded-md p-2 max-h-56 overflow-auto">
          <p className="text-xs font-medium mb-1">预览（只读）</p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left">
                <th className="pr-2">日期</th>
                <th className="pr-2">时间</th>
                <th className="pr-2">代码</th>
                <th className="pr-2">方向</th>
                <th className="pr-2 text-right">数量</th>
                <th className="pr-2 text-right">价格</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((t, idx) => (
                <tr key={idx}>
                  <td className="pr-2">{t.dateNy}</td>
                  <td className="pr-2">{t.time}</td>
                  <td className="pr-2 font-mono">{t.symbol}</td>
                  <td className="pr-2">{t.side}</td>
                  <td className="pr-2 text-right">{t.quantity}</td>
                  <td className="pr-2 text-right">{t.price.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {submitMessage && (
        <p className="text-xs text-muted-foreground whitespace-pre-line">
          {submitMessage}
        </p>
      )}

      <AlertDialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>导入成功</AlertDialogTitle>
            <AlertDialogDescription>
              已成功导入 {successCount} 条交易记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleSuccessConfirm}>确定</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}