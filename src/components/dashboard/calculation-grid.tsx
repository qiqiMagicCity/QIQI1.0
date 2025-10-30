import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculationModules } from "@/lib/data";
import { cn } from "@/lib/utils";

export function CalculationGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {calculationModules.map((module) => (
        <Card key={module.id} className="transition-all hover:shadow-lg hover:-translate-y-1 bg-background">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{module.title}</CardTitle>
            <module.icon className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">--</div>
            <p className="text-xs text-muted-foreground">
              --
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
