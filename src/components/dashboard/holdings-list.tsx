import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function HoldingsList() {
  return (
    <div className="table w-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-semibold">股票</TableHead>
            <TableHead className="text-right font-semibold">价值</TableHead>
            <TableHead className="text-right font-semibold">盈亏 %</TableHead>
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
