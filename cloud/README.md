# CloudBase 日记同步后端

GitHub Pages 只托管前端。部署本目录对应的普通事件云函数到上海 PG 环境，并通过 HTTP 网关暴露 `/diary-sync`；函数内校验应用同步口令，无需邮箱登录。

1. 在现有 PostgreSQL 环境执行 `schema.sql`，创建私有元数据表与私有存储桶。确认已有存储 RLS 策略不允许 anon/authenticated 访问 `little-days-private`。
2. `npm run build:sync`，上传 `cloudfunctions/diary-sync/` 代码包，入口 `index.main`，Node.js 18+。安装其 package.json 依赖。
3. 在函数配置中将服务端 API Key 注入 `CLOUDBASE_APIKEY`，绝不能放进 Vite 环境或前端。当前 PG 体验环境实测临时身份换取存储令牌返回 `INVALID_CREDENTIALS`，因此采用已批准的服务端 Key。测试 Key 有效期为 30 天，到期需更新云端配置；它与用户的固定日记同步口令不同。
4. 配置 `SYNC_ALLOWED_ORIGINS` 为允许的页面来源（默认 GitHub Pages 与本地 5173）。HTTP 网关转发请求体及 Authorization；平台登录鉴权由应用自有口令验证替代。
5. 验证 GET 健康检查、OPTIONS 预检、POST create/pull/push、错误口令拒绝和并发版本冲突。特别确认 SDK 的 update `count:'exact'` 返回真实影响行数；缺失时接口失败，不猜测已提交。
6. 将完整 HTTPS 接口地址配置为前端 `VITE_SYNC_URL`，或更新 `src/sync-config.ts` 的公开默认地址。运行测试和构建，再按原 Pages 工作流发布。

上传先写新的不可变快照文件，再通过单条条件 UPDATE 原子提交头指针；快照文件使用 AES-256-GCM 加密，密钥从高熵同步口令派生。服务端在授权请求时能解密，符合已确认的云端解密能力；这不承诺云服务运营者无法读取。元数据不保存口令明文。旧文件保留以免影响正在读取的设备；正式运行需另配置受控保留/清理策略与资源告警。

下载只取当前头指向的私有文件。上传失败或结果不确定时不删除可能已经提交的文件。最大日记快照 4 MB，平台更小的请求限制须在真实环境核实。请求和日志不得记录同步口令或日记正文。

正式域名、套餐和费用另行确认。默认网关域名仅用于验证；本地 HTTP 验证不证明正式大陆手机网络访问。
