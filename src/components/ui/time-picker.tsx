"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface TimePickerProps {
    value?: string;
    onChange?: (time: string) => void;
    className?: string;
}

export function TimePicker({ value, onChange, className }: TimePickerProps) {
    const [open, setOpen] = React.useState(false);

    // Parse value "HH:mm:ss"
    const [h, m, s] = React.useMemo(() => {
        if (!value) return [16, 0, 0];
        const parts = value.split(":").map(Number);
        return [
            parts[0] || 0,
            parts[1] || 0,
            parts[2] || 0
        ];
    }, [value]);

    const hours = Array.from({ length: 24 }, (_, i) => i);
    const minutes = Array.from({ length: 60 }, (_, i) => i);
    const seconds = Array.from({ length: 60 }, (_, i) => i);

    const updateTime = (newH: number, newM: number, newS: number) => {
        const str = `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}:${String(newS).padStart(2, "0")}`;
        onChange?.(str);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={cn(
                        "w-full justify-start text-left font-normal",
                        !value && "text-muted-foreground",
                        className
                    )}
                >
                    <Clock className="mr-2 h-4 w-4" />
                    {value || "选择时间"}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <div className="flex h-[300px] divide-x">
                    <ScrollArea className="h-full w-[70px]">
                        <div className="flex flex-col p-2">
                            <div className="mb-2 text-center text-xs font-semibold text-muted-foreground">时</div>
                            {hours.map((hour) => (
                                <Button
                                    key={hour}
                                    variant={h === hour ? "default" : "ghost"}
                                    size="sm"
                                    className="w-full shrink-0 mb-1"
                                    onClick={() => updateTime(hour, m, s)}
                                >
                                    {String(hour).padStart(2, "0")}
                                </Button>
                            ))}
                        </div>
                        <ScrollBar orientation="vertical" />
                    </ScrollArea>
                    <ScrollArea className="h-full w-[70px]">
                        <div className="flex flex-col p-2">
                            <div className="mb-2 text-center text-xs font-semibold text-muted-foreground">分</div>
                            {minutes.map((minute) => (
                                <Button
                                    key={minute}
                                    variant={m === minute ? "default" : "ghost"}
                                    size="sm"
                                    className="w-full shrink-0 mb-1"
                                    onClick={() => updateTime(h, minute, s)}
                                >
                                    {String(minute).padStart(2, "0")}
                                </Button>
                            ))}
                        </div>
                        <ScrollBar orientation="vertical" />
                    </ScrollArea>
                    <ScrollArea className="h-full w-[70px]">
                        <div className="flex flex-col p-2">
                            <div className="mb-2 text-center text-xs font-semibold text-muted-foreground">秒</div>
                            {seconds.map((second) => (
                                <Button
                                    key={second}
                                    variant={s === second ? "default" : "ghost"}
                                    size="sm"
                                    className="w-full shrink-0 mb-1"
                                    onClick={() => updateTime(h, m, second)}
                                >
                                    {String(second).padStart(2, "0")}
                                </Button>
                            ))}
                        </div>
                        <ScrollBar orientation="vertical" />
                    </ScrollArea>
                </div>
                <div className="p-2 border-t bg-muted/50">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full h-7 text-xs"
                        onClick={() => {
                            const now = new Date();
                            updateTime(now.getHours(), now.getMinutes(), now.getSeconds());
                        }}
                    >
                        此刻
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
