# Auto-Contract 项目复盘文档

> 生成日期：2026-07-20  
> 用途：给下一个没有上下文的 Codex/开发会话快速了解项目现状、架构、运行方式和维护重点。

## 1. 项目一句话定位

Auto-Contract 是一个用于外贸业务的桌面单据生成器：用户在本地维护客户、产品、港口、贸易户头、合同条款等基础资料，然后生成销售合同、PI、装箱单和商业发票，支持导出 Excel 和 PDF。

## 2. 技术栈

- 前端：React 19、TypeScript、Vite、Tailwind CSS v4、lucide-react、少量 shadcn/Radix 基础组件。
- 桌面端：Tauri 2 + Rust。
- 本地数据：SQLite，通过 Rust `rusqlite` 访问，数据库文件位于 Tauri app data 目录下的 `data/ys-documents.sqlite`。
- 文档导出：以 `templates/` 下的 `.xlsx` 模板为基础，Rust 直接操作 xlsx zip/XML 替换占位符；PDF 导出依赖本机 Excel COM 或 LibreOffice 等转换路径。
- 登录鉴权：Cloudflare Worker + KV，桌面端调用远端 `/verify-login` 校验数字凭证。
- 更新：Tauri updater，从 GitHub Releases 的 `latest.json` 检查更新。

## 3. 关键目录和文件

- `src/App.tsx`：主应用，包含登录、导航、基础资料 CRUD、合同表单、历史单据、导出逻辑、金额/日期/大写金额格式化等大部分前端逻辑。
- `src/lib/desktop-api.ts`：前端到 Tauri Rust command 的封装。
- `src/contractStandardSections.ts`：合同固定标准条款片段，供合同预览/导出拼装使用。
- `src-tauri/src/lib.rs`：Tauri 后端核心；包含 SQLite 表结构/迁移/种子数据、CRUD 命令、xlsx 模板处理、PDF 转换、打开导出文件等。
- `src-tauri/tauri.conf.json`：Tauri 应用配置、窗口尺寸、NSIS 打包、模板资源、updater endpoint。
- `templates/`：四个 Excel 模板：
  - `Sales Contract Template.xlsx`
  - `PI Template.xlsx`
  - `Packing List Template.xlsx`
  - `Commercial Invoice Template.xlsx`
- `workers/auth/src/index.ts`：登录 Worker，只接收凭证并与 KV 中的哈希记录比对。
- `scripts/`：开发服务启动、登录凭证新增、KV 批量准备/同步脚本。
- `docs/ui-ux-design.md`：产品和 UI/UX 设计说明。

## 4. 常用命令

```bash
npm install
npm run dev
npm run dev:web
npm run build
npm run build:desktop
```

鉴权相关：

```bash
npm run auth:add-credential -- <数字凭证> --until <ISO时间> --note "<备注>"
npm run auth:prepare-kv
npm run auth:sync-kv
npm run auth:deploy
```

注意：

- `npm run dev` 会启动 Tauri，并通过 `beforeDevCommand` 调用 `npm run dev:web`。
- Vite 固定使用 `127.0.0.1:5173`，`scripts/start-dev-server.mjs` 会检查端口是否已被本项目占用。
- PDF 导出在 Windows 上更依赖本机 Excel；如果机器没有 Excel 或有弹窗阻塞，可能导出失败。

## 5. 应用主要业务流

1. 用户打开桌面应用，初始窗口是登录尺寸 `452 x 392`。
2. 前端调用 `https://auto-contract-auth.wnhoper.workers.dev/verify-login` 校验数字凭证。
3. 登录成功后窗口调整到主工作台尺寸 `1280 x 820`，最小尺寸 `1080 x 680`。
4. 前端通过 `refreshAll()` 一次性读取基础资料表和历史合同表。
5. 用户在“单据生成”页选择买方、卖方、客户经理、产品、条款配置、港口、贸易术语、数量、单价、预付款、PI 有效期、桶数、毛重、PO No. 等。
6. 前端根据输入实时计算总金额、尾款、净重、毛重、体积等，并构建导出 payload。
7. 用户可先保存当前单据到 `contracts` 历史表，也可直接导出：
   - 合同：`generate_contract_excel/pdf`
   - PI：`generate_pi_excel/pdf`
   - 装箱单：`generate_packing_list_excel/pdf`
   - 发票：`generate_commercial_invoice_excel/pdf`
8. Rust 后端读取模板、替换占位符和 logo，输出到用户文档目录下的 `YS Contracts` 文件夹。

## 6. 数据库模型概览

Rust 后端在 `open_database()` 中创建和迁移表。当前表：

- `users`：预留用户表。
- `companies`：贸易户头/卖方信息，含中英文名称、地址、银行、SWIFT、美元账号、电话、备注、logo。
- `customers`：客户/买方信息，含中英文名称、地址、电话、客户性质、国家、邮箱、联系人、NTN。
- `customer_managers`：客户经理姓名、电话、邮箱。
- `ports`：港口中英文名称。
- `products`：产品中英文名、HS code、描述、纯度/规格、每桶净重、是否易制毒。
- `contract_terms`：条款库，含条款编码、中英文内容。
- `term_configurations`：条款配置方案。
- `term_configuration_items`：配置方案和条款库的关联，含排序。
- `contracts`：历史单据，保存合同号、日期、买卖方、产品、条款配置、数量、价格、付款、港口、贸易条款、托盘、客户经理、PO、桶数、毛重等。

后端有简单迁移函数 `migrate_column()`，新增字段时通常是在建表 SQL 后追加一次迁移调用。

## 7. 前端模块说明

`src/App.tsx` 是当前最大文件，主要包含：

- 登录和更新：
  - `verifyLoginCredential()`
  - `checkForAppUpdate()`
  - `prepareLoginWindow()`
  - `prepareMainWindow()`
- 数据 CRUD：
  - `refreshAll()`
  - `saveRow()`
  - `deleteRow()`
  - `saveTermConfiguration()`
- 单据生成：
  - `ContractPanel`
  - `saveCurrentContract()`
  - `generateContract()`
  - `generatePi()`
  - `generatePackingList()`
  - `generateCommercialInvoice()`
- 预览和导出字段：
  - `buildContractPreviewFromRows()`
  - `buildContractExcelFields()`
  - `buildPiExcelFields()`
  - `buildShippingExcelFields()`
- 格式化工具：
  - 日期英文/中文格式化
  - Excel 日期 serial
  - 数量/金额格式化
  - 美元英文大写
  - 美元中文大写

维护建议：如果后续功能继续增加，优先考虑把 `App.tsx` 拆分为 `features/contract`、`features/master-data`、`features/auth`、`lib/formatters` 等模块，否则单文件会越来越难审查。

## 8. Tauri/Rust 后端说明

`src-tauri/src/lib.rs` 承担三类责任：

- 数据层：SQLite 建表、迁移、种子数据、CRUD。
- 导出层：查找模板、替换 xlsx XML 占位符、插入 logo、生成 Excel。
- 系统层：PDF 转换、打开导出文件、窗口样式、Tauri command 注册。

前端通过 `src/lib/desktop-api.ts` 调用这些 commands。表名和字段白名单在 Rust 的 `TABLE_NAMES`、`table_fields()` 中维护，新增字段时必须同时检查：

- 前端类型和表单字段。
- Rust `table_fields()` 允许字段。
- SQLite 建表 SQL。
- `migrate_column()` 是否需要迁移旧用户数据库。
- 模板占位符是否需要新增。

## 9. 模板和占位符机制

导出不是用 Excel API 逐格写入，而是把 `.xlsx` 当作 zip 包处理：

1. 找到模板文件。
2. 解压 xlsx 内部 XML。
3. 替换形如 `{{field_name}}` 的占位符。
4. 对 PI 模板部分单元格做日期 serial 写入。
5. 处理 logo 数据。
6. 重新打包输出 `.xlsx`。
7. PDF 导出时先生成临时 `.exporting.xlsx`，再调用转换器生成 `.pdf`。

维护模板时要特别注意：

- 占位符名称必须和前端 `build*ExcelFields()` 返回字段一致。
- Excel 可能把字符串拆到 shared strings 或多个 XML 节点中，复杂占位符要实际导出验证。
- PI 的部分日期字段通过单元格引用特殊处理，改模板位置时要同步检查 Rust 代码。

## 10. 登录鉴权机制

桌面端只把用户输入的数字凭证发送给 Worker。Worker 逻辑：

- 接口：`POST /verify-login`
- 请求体：`{ "credential": "..." }`
- Worker 用 `AUTH_PEPPER` 和凭证拼接后做 SHA-256。
- KV key 格式：`credential:<hash>`。
- KV value 包含 `enabled`、`validFrom`、`validUntil`、`note`。
- 返回：
  - `{ valid: true }`
  - 或 `{ valid: false, message: "凭证无效/尚未生效/已过期" }`

本地凭证文件默认是 `auth/login-credentials.json`，示例文件是 `auth/login-credentials.example.json`。真实凭证不应提交到公开仓库。

## 11. 打包和更新

- 当前版本：`1.0.13`，同时存在于 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。
- Windows 打包目标：NSIS。
- 模板资源通过 `bundle.resources = ["../templates/*"]` 打进安装包。
- updater endpoint：
  - `https://github.com/Yinlongcoding/Auto-Contract/releases/latest/download/latest.json`
- 更新策略：启动时检查，发现新版后用户确认下载；如果取消，应用会退出。

发布新版本时要同步检查：

- 三处版本号是否一致。
- GitHub Release 是否包含 Tauri updater 需要的 `latest.json` 和安装包。
- 签名公钥/私钥流程是否正确。

## 12. 当前已知风险和注意点

- `src/App.tsx` 当前承担过多职责，是后续维护的主要复杂度来源。
- 本次复盘时 `git status --short` 显示 `src/App.tsx` 已有未提交修改；后续会话不要随意覆盖或回退用户改动。
- PowerShell 终端中部分中文源码可能显示乱码，但用 `Get-Content -Encoding utf8` 读取关键文件可以正常显示。
- PDF 导出高度依赖本机环境，尤其 Windows Excel COM 自动化；测试时要覆盖“无 Excel、有弹窗、文件被占用、路径含特殊字符”等情况。
- SQLite 没有复杂迁移框架，目前靠 `migrate_column()` 追加列；删除/改名字段会更麻烦。
- 前端非 Tauri runtime 下的 fallback API 只用于开发占位，实际导出会抛错。
- Worker CORS 当前允许 `*`，凭证本身只做哈希匹配，但如果安全要求提高，可考虑收紧来源或增加速率限制。

## 13. 建议的下一步复盘入口

下个会话如果要继续开发，建议按这个顺序读：

1. `README.md`
2. `AGETN.md`
3. `package.json`
4. `src/lib/desktop-api.ts`
5. `src-tauri/src/lib.rs`
6. `src/App.tsx`
7. `workers/auth/src/index.ts`
8. 需要改导出时再打开 `templates/` 对应 Excel 模板

如果目标是改界面，先读 `docs/ui-ux-design.md` 和 `src/App.tsx`。  
如果目标是改数据字段，先读 `src-tauri/src/lib.rs` 的表结构和 `src/App.tsx` 的表单/字段映射。  
如果目标是改鉴权，先读 `workers/auth/README.md`、`workers/auth/src/index.ts` 和 `scripts/*auth*.mjs`。

