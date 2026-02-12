
import { spawn, execSync, spawnSync } from 'child_process';
import { platform } from 'os';
import path from 'path';
import fs from 'fs';

const PORT = 9002;
const IS_WINDOWS = platform() === 'win32';

/**
 * [EC 10A Guardrail] Clean build artifacts to prevent EPERM issues in local dev.
 */
function cleanBuildArtifacts() {
    const nextDir = path.join(process.cwd(), '.next');
    if (fs.existsSync(nextDir)) {
        try {
            console.log(`[启动助手] 正在清理 .next 缓存以防止文件锁定...`);
            if (IS_WINDOWS) {
                // Windows specific recursive delete to be more robust
                spawnSync('powershell.exe', ['-Command', `Remove-Item -Recurse -Force "${nextDir}"`], { stdio: 'ignore' });
            } else {
                fs.rmSync(nextDir, { recursive: true, force: true });
            }
            console.log(`[启动助手] .next 清理完成。`);
        } catch (e: any) {
            console.warn(`[警告] 无法清理 .next 目录 (可能被占用): ${e.message}`);
        }
    }
}

/**
 * 检查端口是否被占用，如果被占用则杀掉进程
 */
function killPort(port: number) {
    try {
        console.log(`[启动助手] 正在检查端口 ${port} 占用情况...`);

        if (IS_WINDOWS) {
            // 查找占用端口的 PID
            let output = '';
            try {
                output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            } catch (e) {
                console.log(`[启动助手] 端口 ${port} 当前空闲。`);
                return;
            }

            if (output) {
                console.log(`[启动助手] 发现端口 ${port} 被占用，准备清理...`);
                const lines = output.split('\n');
                const pids = new Set<string>();

                lines.forEach(line => {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && /^\d+$/.test(pid) && pid !== '0') {
                        pids.add(pid);
                    }
                });

                if (pids.size > 0) {
                    pids.forEach(pid => {
                        try {
                            console.log(`[端口清理] 正在强制终止进程 PID: ${pid}`);
                            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
                        } catch (e: any) {
                            console.log(`[端口清理] 终止 PID ${pid} 失败 (可能已自动退出): ${e.message}`);
                        }
                    });

                    // 循环检查直到端口释放
                    let checks = 0;
                    while (checks < 10) {
                        try {
                            const check = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
                            if (!check) {
                                console.log(`[端口清理] 端口 ${port} 已成功释放。`);
                                return;
                            }
                        } catch {
                            console.log(`[端口清理] 端口 ${port} 已成功释放。`);
                            return;
                        }
                        execSync('timeout /t 1 /nobreak > nul', { shell: 'cmd.exe' });
                        checks++;
                    }
                }
            }
        } else {
            const getPid = () => {
                try {
                    return execSync(`lsof -t -i:${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
                } catch { return ''; }
            };

            let pid = getPid();
            if (pid) {
                console.log(`[端口清理] 发现端口 ${port} 被占用 (PID: ${pid})，正在清理...`);
                const pids = pid.split('\n');
                pids.forEach(p => {
                    try { execSync(`kill -9 ${p}`, { stdio: 'ignore' }); } catch { }
                });
            }
        }
    } catch (error: any) {
        console.error('[错误] 端口清理过程中发生异常:', error.message);
    }
}

async function startDev() {
    console.log(`==================================================`);
    console.log(`   QIQI1.0 开发服务器启动助手 (端口 ${PORT})`);
    console.log(`==================================================`);

    // 1. 清理端口与旧产物 (Guardrail 1)
    killPort(PORT);
    cleanBuildArtifacts();

    // 2. 启动 Next.js
    console.log(`[启动助手] 正在启动 Next.js 开发服务器...`);

    const cmd = IS_WINDOWS ? 'npm.cmd' : 'npm';
    // [FIX] Increase memory limit to 4GB to prevent "Internal Server Error" (OOM) on Windows
    const next = spawn(cmd, ['exec', 'next', 'dev', '--', '-p', String(PORT), '-H', '127.0.0.1'], {
        stdio: 'inherit',
        shell: true,
        env: {
            ...process.env,
            FORCE_COLOR: '1',
            NODE_OPTIONS: '--max-old-space-size=4096'
        }
    });

    next.on('error', (err) => {
        console.error('[启动助手] 启动失败:', err);
    });

    next.on('close', (code) => {
        if (code !== 0 && code !== null) {
            console.log(`\n[启动助手] ❌ Next.js 异常退出，退出码: ${code}`);

            // [Guardrail 1.2] Provide clear hints for common EPERM issues
            if (IS_WINDOWS) {
                console.log(`--------------------------------------------------`);
                console.log(`💡 排查建议 (Troubleshooting):`);
                console.log(`1. 权限冲突: 请检查是否还有其他 IDE 窗口或 Node 进程占用了 .next 目录。`);
                console.log(`2. 文件锁定: 尝试手动删除 .next 目录。`);
                console.log(`3. 杀毒软件: 建议将项目目录加入杀毒软件白名单。`);
                console.log(`4. 多实例冲突: 确保没有两个终端在运行同一个项目的开发服务器。`);
                console.log(`--------------------------------------------------`);
            }
        } else {
            console.log('[启动助手] 服务已停止。');
        }
        process.exit(code ?? 0);
    });
}

startDev();
