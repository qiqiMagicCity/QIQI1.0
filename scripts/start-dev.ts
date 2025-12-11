
import { spawn, execSync } from 'child_process';
import { platform } from 'os';

const PORT = 9002;

/**
 * 检查端口是否被占用，如果被占用则杀掉进程
 */
function killPort(port: number) {
    try {
        const isWindows = platform() === 'win32';

        if (isWindows) {
            // 查找占用端口的 PID
            const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();

            if (output) {
                console.log(`[端口清理] 发现端口 ${port} 被占用，正在清理...`);
                const lines = output.split('\n');

                const pids = new Set<string>();

                lines.forEach(line => {
                    // TCP    0.0.0.0:9002           0.0.0.0:0              LISTENING       22652
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && /^\d+$/.test(pid) && pid !== '0') {
                        pids.add(pid);
                    }
                });

                if (pids.size > 0) {
                    pids.forEach(pid => {
                        try {
                            console.log(`[端口清理] 正在终止进程 PID: ${pid}`);
                            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
                        } catch (e) {
                            // 忽略错误，可能是进程已经不存在
                        }
                    });
                    console.log(`[端口清理] 端口 ${port} 已清理。`);
                }
            }
        } else {
            // Linux/Mac implementation if needed in future
            try {
                const pid = execSync(`lsof -t -i:${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
                if (pid) {
                    console.log(`[端口清理] 发现端口 ${port} 被占用 (PID: ${pid})，正在清理...`);
                    execSync(`kill -9 ${pid}`, { stdio: 'ignore' }); // Force kill
                    console.log(`[端口清理] 端口 ${port} 已清理。`);
                }
            } catch (e) {
                // lsof return non-zero if no process found, which is fine
            }
        }
    } catch (error: any) {
        if (error.status !== 1) { // findstr returns 1 if not found, which is fine
            console.log('[端口清理] 端口检查时也并非异常，继续启动:', error.message);
        }
    }
}

function startDev() {
    console.log(`[启动助手] 正在准备启动开发服务器 (端口 ${PORT})...`);

    // 1. 清理端口
    killPort(PORT);

    // 2. 启动 Next.js
    console.log('[启动助手] 启动 Next.js...');

    // Inherit stdio so colors and interaction work
    const next = spawn('next', ['dev', '-p', String(PORT)], {
        stdio: 'inherit',
        shell: true
    });

    next.on('close', (code) => {
        process.exit(code ?? 0);
    });
}

startDev();
