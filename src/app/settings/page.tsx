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

export default function SettingsPage() {
  const { ready, user } = useRequireAuth();
  const auth = useAuth();
  const { toast } = useToast();
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
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="account">账户</TabsTrigger>
              <TabsTrigger value="appearance">外观</TabsTrigger>
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
                  <CardDescription>自定义应用的外观和感觉。在亮色和暗色主题间切换。</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground">
                    主题切换功能正在开发中，敬请期待！
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
