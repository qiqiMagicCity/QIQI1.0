import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculationModules } from "@/lib/data";
import { cn } from "@/lib/utils";

export function CalculationGrid() {
  return (
    <section id="grid" className="scroll-mt-20">
      <h2 className="mb-4 text-2xl font-bold tracking-tight">分析仪表盘</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {calculationModules.map((module) => (
          <Card key={module.id} className="transition-all hover:shadow-lg hover:-translate-y-1 hover:bg-card/80">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{module.title}</CardTitle>
              <module.icon className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{module.value}</div>
              {module.change && (
                <p className={cn("text-xs", module.changeType === 'positive' ? 'text-emerald-400' : 'text-destructive')}>
                  <span className="font-semibold">{module.change}</span> 从上期
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
