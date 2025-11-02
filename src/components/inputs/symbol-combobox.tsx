'use client';

import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown } from 'lucide-react';
import { searchSymbols, SymbolEntry } from '@/data/symbol-index';
import { cn } from '@/lib/utils';

type Props = {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSelected?: (symbol: string) => void;
};

export default function SymbolCombobox({
  value,
  onChange,
  placeholder = '输入代码/中文/英文查找，例如：AAPL / 苹果 / Apple',
  disabled,
  className,
  onSelected,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState(value ?? '');

  React.useEffect(() => {
    // 同步外部值
    setQuery(value ?? '');
  }, [value]);

  const results: SymbolEntry[] = React.useMemo(() => {
    const q = query?.trim();
    if (!q) return [];
    return searchSymbols(q, 30);
  }, [query]);

  const select = (sym: string) => {
    const up = sym.trim().toUpperCase();
    onChange?.(up);
    setQuery(up);
    setOpen(false);
    onSelected?.(up);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between', className)}
          disabled={disabled}
        >
          {value ? value : <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[420px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
            // 允许按 Enter 直接使用当前输入（即便不在索引）
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (query.trim()) select(query);
              }
            }}
          />
          <CommandList>
            {(!results || results.length === 0) && (
              <>
                <CommandEmpty>未找到匹配。按 Enter 使用“{query}”。</CommandEmpty>
              </>
            )}
            {results && results.length > 0 && (
              <CommandGroup heading="匹配结果">
                {/* 顶部提供“使用当前输入” */}
                <CommandItem
                  value={`__use_${query}`}
                  onSelect={() => select(query)}
                >
                  使用 “{query.trim().toUpperCase()}”
                </CommandItem>
                {results.map((e) => (
                  <CommandItem
                    key={e.symbol}
                    value={e.symbol}
                    onSelect={() => select(e.symbol)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{e.symbol}</span>
                      <span className="text-muted-foreground">
                        {e.nameZh ?? e.nameEn}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
