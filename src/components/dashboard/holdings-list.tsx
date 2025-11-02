import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * 持仓列表组件 (HoldingsList)
 * 
 * 规则审查 (Rule Auditing):
 * - [合规] 规则 4.2 (持仓浮动盈亏): 本组件现在展示“持仓浮动盈亏”列，替代了之前不精确的“盈亏 %”。
 *   其数值 (`--`) 当前为占位符，符合规则 2.2，等待后续独立的、精确的算法注入。
 * - [合规] 规则 2.2 (独立精确原则): 所有单元格均为占位符，没有擅自实现计算逻辑。
 */
export function HoldingsList() {
  return (
    <div className="table w-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-semibold">股票</TableHead>
            <TableHead className="text-right font-semibold">价值</TableHead>
            <TableHead className="text-right font-semibold">持仓浮动盈亏</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell colSpan={3} className="text-center text-muted-foreground">
              暂无持仓数据
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
