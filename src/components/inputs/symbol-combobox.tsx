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
    setQuery(value ?? '');
  }, [value]);

  const results: SymbolEntry[] = React.useMemo(() => {
    const q = query?.trim();
    if (!q) return [];
    return searchSymbols(q, 30);
  }, [query]);

  const select = (symbol: string) => {
    const up = symbol.trim().toUpperCase(); // Ensure uppercase for consistency
    onChange?.(up);
    setQuery(up);
    setOpen(false);
    onSelected?.(up);
  };

  const onKeyDownUseQuery = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (!results || results.length === 0)) {
      e.preventDefault(); // Prevent form submission if this is part of a form
      const q = query.trim();
      if (q) select(q.toUpperCase());
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between', className)}
          disabled={disabled}
        >
          {value ? value : <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,calc(100vw-2rem))] sm:w-[420px] p-0 z-[60]" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
            onKeyDown={onKeyDownUseQuery}
          />
          <CommandList>
            {(!results || results.length === 0) && (
              <CommandEmpty>未找到匹配。按 Enter 使用“{query}”。</CommandEmpty>
            )}
            {results && results.length > 0 && (
              <CommandGroup heading="匹配结果">
                <CommandItem value={`__use_${query}`} onSelect={() => select(query)}>
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
