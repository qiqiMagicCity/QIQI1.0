'use client';

import { useRequireAuth } from '@/components/auth/guards';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/firebase';
import { updateProfile } from 'firebase/auth';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { EodCheck } from '@/components/settings/eod-check';
import { DebugM9Breakdown } from '@/components/dashboard/debug-m9-breakdown';
import { DebugM6Breakdown } from '@/components/dashboard/debug-m6-breakdown';
import { useTheme } from '@/contexts/theme-provider';
import { cn } from '@/lib/utils';
import { TransactionAnalysisLiveSelfCheck } from '@/components/debug/transaction-analysis-self-check';

export default function SettingsPage() {
  const { ready, user } = useRequireAuth();
  const auth = useAuth();
  const { toast } = useToast();
  const { mode, setMode, color, setColor } = useTheme();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSaving(true);
    try {
      await updateProfile(user, { displayName });
      toast({
        title: '成功',
        description: '您的显示名称已更新。',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: '更新失败',
        description: error.message || '无法更新您的个人资料，请稍后再试。',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">正在加载设置...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <DashboardHeader />
      <main className="flex-1 p-4 md:p-6 lg:p-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="outline" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">返回首页</span>
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">设置</h1>
              <p className="text-muted-foreground">管理您的账户设置和网站偏好。</p>
            </div>
          </div>
          <Separator />

          <Tabs defaultValue="account">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="account">账户</TabsTrigger>
              <TabsTrigger value="appearance">外观</TabsTrigger>
              <TabsTrigger value="data-check">数据自检</TabsTrigger>
            </TabsList>

            <TabsContent value="account">
              <Card>
                <CardHeader>
                  <CardTitle>账户信息</CardTitle>
                  <CardDescription>更新您的个人资料。更改会应用到整个应用中。</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleProfileUpdate} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">邮箱</Label>
                      <Input id="email" type="email" value={user?.email || ''} disabled />
                      <p className="text-xs text-muted-foreground">邮箱地址不可更改。</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="displayName">显示名称</Label>
                      <Input
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="您希望被如何称呼？"
                      />
                    </div>
                    <Button type="submit" disabled={isSaving}>
                      {isSaving ? '正在保存...' : '保存更改'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="appearance">
              <Card>
                <CardHeader>
                  <CardTitle>外观</CardTitle>
                  <CardDescription>自定义应用的外观和感觉。选择您喜欢的主题颜色和模式。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  <div className="space-y-4">
                    <Label className="text-base">颜色主题</Label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { name: 'green', label: 'Luck Green', color: 'bg-emerald-500' },
                        { name: 'blue', label: 'Ocean Blue', color: 'bg-blue-500' },
                        { name: 'violet', label: 'Mystic Purple', color: 'bg-violet-500' },
                        { name: 'orange', label: 'Sunset Orange', color: 'bg-orange-500' },
                      ].map((theme) => (
                        <div
                          key={theme.name}
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-1 hover:border-primary transition-all",
                            color === theme.name ? "border-primary" : "border-transparent"
                          )}
                          onClick={() => setColor(theme.name as any)}
                        >
                          <div className="space-y-2 rounded-md bg-muted p-2">
                            <div className={cn("h-20 rounded-lg shadow-sm", theme.color)} />
                            <div className="space-y-1">
                              <p className="text-sm font-medium leading-none">{theme.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {color === theme.name ? '当前使用' : '点击切换'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <Label className="text-base">显示模式</Label>
                    <div className="grid grid-cols-3 gap-4">
                      <Button
                        variant={mode === 'light' ? 'default' : 'outline'}
                        className="w-full"
                        onClick={() => setMode('light')}
                      >
                        亮色模式
                      </Button>
                      <Button
                        variant={mode === 'dark' ? 'default' : 'outline'}
                        className="w-full"
                        onClick={() => setMode('dark')}
                      >
                        暗色模式
                      </Button>
                      <Button
                        variant={mode === 'system' ? 'default' : 'outline'}
                        className="w-full"
                        onClick={() => setMode('system')}
                      >
                        跟随系统
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      &quot;跟随系统&quot;将自动匹配您设备的显示设置。
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="data-check">
              <Card>
                <CardHeader>
                  <CardTitle>数据自检与修复</CardTitle>
                  <CardDescription>检查数据完整性并验证计算结果。</CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="eod">
                    <TabsList className="grid w-full grid-cols-4">
                      <TabsTrigger value="eod">EOD 数据检查</TabsTrigger>
                      <TabsTrigger value="m6">M6 当日盈亏</TabsTrigger>
                      <TabsTrigger value="m9">M9 累计盈亏</TabsTrigger>
                      <TabsTrigger value="account-analysis">账户分析页面自检</TabsTrigger>
                    </TabsList>
                    <TabsContent value="eod" className="mt-4">
                      <EodCheck />
                    </TabsContent>
                    <TabsContent value="m6" className="mt-4">
                      <DebugM6Breakdown />
                    </TabsContent>
                    <TabsContent value="m9" className="mt-4">
                      <DebugM9Breakdown />
                    </TabsContent>
                    <TabsContent value="account-analysis" className="mt-4">
                      <TransactionAnalysisLiveSelfCheck />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
