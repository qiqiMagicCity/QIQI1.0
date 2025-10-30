import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculationModules } from "@/lib/data";
import { cn } from "@/lib/utils";

export function CalculationGrid() {
  return (
    <section id="grid" className="scroll-mt-20">
      <h2 className="mb-4 text-2xl font-semibold tracking-tight">分析仪表盘</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {calculationModules.map((module) => (
          <Card key={module.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{module.title}</CardTitle>
              <module.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{module.value}</div>
              {module.change && (
                <p className={cn("text-xs text-muted-foreground", module.changeType === 'positive' ? 'text-emerald-500' : 'text-destructive')}>
                  {module.change} 从上期
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
