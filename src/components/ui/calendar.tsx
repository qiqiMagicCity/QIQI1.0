"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { nowNyCalendarDayString } from "@/lib/ny-time"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  today,
  ...props
}: CalendarProps) {
  const nyToday = React.useMemo(() => {
    const s = nowNyCalendarDayString(); // 'YYYY-MM-DD' in America/New_York
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d); // local shadow date object for DayPicker "today" highlight
  }, []);

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      today={today ?? nyToday}
      className={cn("p-3", className)}
      // 启用下拉菜单模式
      captionLayout="dropdown-buttons"
      fromYear={1990}
      toYear={2040}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        // [修复] 隐藏默认的文字标题，防止与下拉框重叠
        caption_label: "hidden",
        // [修复] 调整下拉容器布局，确保居中且有间距
        caption_dropdowns: "flex justify-center gap-2 items-center w-full px-8",
        nav: "absolute inset-x-0 flex items-center justify-between pointer-events-none", // 导航按钮绝对定位在两端
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 pointer-events-auto z-10"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={cn("h-4 w-4", className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={cn("h-4 w-4", className)} {...props} />
        ),
        // [优化] 自定义下拉菜单组件
        Dropdown: ({ value, onChange, children, ...props }: any) => {
          const options = React.Children.toArray(children) as React.ReactElement<React.HTMLProps<HTMLOptionElement>>[];
          // [Fix] 这里的 value 可能是数字也可能是字符串，统一转字符串比对，确保能找到 selected
          const selected = options.find((child) => child.props.value?.toString() === value?.toString());

          const handleChange = (value: string) => {
            const changeEvent = {
              target: { value },
            } as React.ChangeEvent<HTMLSelectElement>;
            onChange?.(changeEvent);
          };

          // 判断是年份还是月份，以调整宽度
          const isYear = value > 1000;

          return (
            <Select
              value={value?.toString()}
              onValueChange={handleChange}
            >
              <SelectTrigger
                className={cn(
                  "h-8 border-zinc-700 bg-zinc-800 text-xs font-medium focus:ring-0 focus:ring-offset-0 px-2",
                  // [Fix] 增加宽度，避免中文被截断
                  isYear ? "w-[85px]" : "w-[75px]"
                )}
              >
                <SelectValue>{selected?.props?.children}</SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-[240px] min-w-[var(--radix-select-trigger-width)] overflow-hidden bg-zinc-950 border-zinc-800 z-[9999]">
                {/* 使用 ScrollArea 确保长列表可滚动 */}
                <ScrollArea className="h-[200px]">
                  {options.map((option, id) => (
                    <SelectItem
                      key={`${option.props.value}-${id}`}
                      value={option.props.value?.toString() ?? ""}
                      className="text-xs focus:bg-zinc-800 focus:text-white cursor-pointer"
                    >
                      {option.props.children}
                    </SelectItem>
                  ))}
                </ScrollArea>
              </SelectContent>
            </Select>
          )
        }
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
