# dsh-android-emulator-helper

[English](README.md) | **简体中文**

包名为 `@zhz8888/dsh-android-emulator-helper`，插件页显示的是本地化名称——英文 **Android Emulator Helper**、中文 **Android 模拟器助手**——由 `locale/en.json` 与 `locale/zh.json` 提供，一句话描述也在其中。

把 ZCode 官方 `android-emulator@0.1.0` 插件移植为 **DSH（DeepSeek Harness）原生插件**：原有 23 个 MCP 工具全部保留为 DSH 原生工具，并新增一个完整的 **设置页面**（设置 → Android 模拟器），让 SDK、模拟器、系统镜像、构建与输出目录等参数都能在应用里配置，而不是靠环境变量。

- 工具名、参数名与原插件完全一致，为原 MCP 服务器写的工作流可直接迁移。
- 设置项 = 原插件 `userConfig` 的 7 个字段 + 10 个实用扩展。
- 设置页在「设置」侧栏新增一个独立分区，含分组表单、下拉与建议列表、内联校验、「检测环境」与「刷新设备与 AVD」按钮。

## 目录

- [安装](#安装)
- [设置页面](#设置页面)
- [工具清单](#工具清单)
- [Skill 与斜杠命令](#skill-与斜杠命令)
- [与原插件的差异](#与原插件的差异)
- [架构](#架构)
- [开发与验证](#开发与验证)
- [已知限制](#已知限制)
- [版本](#版本)
- [许可](#许可)

## 安装

### 1. 先安装依赖

包本身只发布源码与手写的客户端 bundle，运行依赖由 DSH profile 提供。

```bash
cd /path/to/dsh-android-emulator-helper
pnpm install
```

本插件 import 的官方包 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` **全部声明在 `peerDependencies`**，由宿主提供：profile 里本来就带着它们，解析到宿主那一份还能保证设置表单背后只有一个 `schemastery` 实例。上面的 `pnpm install` 只为开发与测试把它们装到本仓库；它们声明的区间就是 [DSH 版本闸门](#dsh-版本闸门)所述的 DSH 版本要求。

### 2. 装进 profile

**DSH Desktop（本机 GUI）**：`desktop` profile 由 Electron 应用独占管理，`dsh plugin --profile desktop` 会被 CLI 主动拒绝。请通过应用内的插件管理器安装：把本目录加入本机连接器/插件源，或使用插件管理器的「安装」入口指向本地目录。

**CLI / 其他 profile**：

```bash
dsh plugin --profile <profile> add /absolute/path/to/dsh-android-emulator-helper
```

`dsh.bundle.patch` 已声明，因此安装后 DSH 的 reconcile 会自动把本包追加到 `dsh.profile.bundles`，profile 启动时合并 `cordis.patch.yml`，挂载唯一一行 host 入口。**不要**再手动往 profile 自己的 `cordis.patch.yml` 里加同一行，重复挂载会让同名工具二次注册并在加载期报错。

### 3. 打开设置页

重启/热加载后，打开 **设置 → Android 模拟器**。页面在 host 半侧真正提供了该设置命名空间时才会出现；反之不会留下任何痕迹。

### DSH 版本闸门

DSH 版本要求是 **`>=0.2.0-rc.2`——只有下界，没有上界**，三处声明逐字一致（`peerDependencies`、`engines.dsh`、`dsh.compatibility.dsh`）：低于下界的运行时会**直接拒绝安装**，同时未来的稳定版都不会被排除；`dsh.compatibility.dshReleases` 记录的是本插件真正跑过验证的那个版本。

写上界会在 DSH 每次升版时逼着插件重发一次放宽范围，而 `^` 区间会静默漏掉下一个版本元组的预发布版。真正被执行的只有 peer 区间——`dsh plugin add` 走的是 `@deepseek-ai/dsh*` 的 peer 解析，而 harness 今天既不读 `engines.dsh` 也不读 `dsh.compatibility`——所以三份声明由 `test/manifest.test.js` 逐个比对，而不是靠自觉。

只有一个 node-semver 细节绕不开：`0.2.1-alpha.1` 这类**新元组的预发布**在 npm/pnpm 的默认规则下不被放行，安装会失败。此时二选一——给范围补一条该元组的分支（`">=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-0"`），或让 pnpm 放宽 peer 校验：

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-android-emulator-helper \
  --config.strict-peer-dependencies=false
```

稳定版（`0.2.0`、`0.2.1`、`0.3.0`、`1.0.0`…）不受这个细节影响，一律放行。

## 设置页面

设置命名空间 = profile patch 行 id = `android-emulator-helper`（同时是 `dsh.name`）。页面通过 `ctx.configForms` 读写，因此具备暂存编辑、脏值检测、内联校验、乐观并发（revision）与「已覆盖/恢复默认」语义。页面自绘标题、每个分组一张卡片（卡片边框就是分组之间的分隔），保存按钮位于底部悬浮胶囊操作栏，只在有可操作内容时出现：有暂存改动、正在写入，或一次失败值得重试。

| 分组 | 设置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| SDK 与工具链 | `sdkPath` | 文本 | 空 | Android SDK 根目录；留空时探测 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 与常见路径 |
| | `jdkMajor` | 文本（建议来自本机 JDK） | `17` | JDK 主版本，用于预检与安装指引 |
| | `buildToolsVersion` | 文本（建议来自已装 build-tools） | `35.0.0` | 安装指引引用的 build-tools 版本 |
| 模拟器与设备 | `defaultAvd` | 文本（建议来自本机 AVD） | `medium_phone` | 需要启动模拟器时优先使用 |
| | `defaultSerial` | 文本（建议来自已连接设备） | 空 | 优先使用的设备序列号 |
| | `autoStartEmulator` | 开关 | 开 | 关闭后无可用设备时直接报错，不启动模拟器 |
| | `emulatorArgs` | 多行文本 | 空 | 额外 `emulator` 参数，每行一个，`#` 为注释 |
| | `bootTimeoutSeconds` | 整数 | `180` | 模拟器启动超时（秒） |
| API 与系统镜像 | `apiLevel` | 文本（建议来自已装 platform/镜像） | `35` | `compileSdk` 与系统镜像包名使用的 API 级别 |
| | `systemImageVariant` | 下拉 | `default` | `default` / `google_apis` / `google_apis_playstore` |
| | `systemImageAbi` | 下拉 | 自动 | 留空按宿主架构，Apple Silicon 用 `arm64-v8a` |
| | `minSdk` | 整数 | `23` | `android_create_app` 生成项目的默认 minSdk |
| 构建 | `buildTimeoutSeconds` | 整数 | `600` | 单次 assemble 的最长运行时间（秒） |
| | `gradleExtraArgs` | 多行文本 | 空 | 额外 Gradle 参数，每行一个 |
| 输出目录与日志 | `dataDir` | 文本 | 空 | 截图与构建日志根目录；留空用 `$DSH_HOME/android-emulator-helper` |
| | `screenshotDir` | 文本 | 空 | 截图目录；留空用 `<数据目录>/screenshots` |
| | `logTailLines` | 整数 | `500` | `android_logs` 未指定行数时的默认行数 |

页面底部两个按钮调用 host 半侧的两个精确 Fetch 路由：

- **检测环境** → `GET /api/android-emulator-helper/status`，返回与 `android_preflight` 相同的检查结果，逐条显示状态、详情与修复建议。
- **刷新设备与 AVD** → `GET /api/android-emulator-helper/inventory`，探测 SDK 根目录、AVD、已连接设备、已安装 JDK、已装系统镜像/platform/build-tools，用于填充上方字段的建议列表。

### 兼容旧配置

原插件的 7 个字段仍会回落到同名环境变量（`ANDROID_PLUGIN_SDK_PATH`、`ANDROID_PLUGIN_DEFAULT_AVD`、`ANDROID_PLUGIN_API_LEVEL`、`ANDROID_PLUGIN_BUILD_TOOLS_VERSION`、`ANDROID_PLUGIN_SYSTEM_IMAGE_VARIANT`、`ANDROID_PLUGIN_SYSTEM_IMAGE_ABI`、`ANDROID_PLUGIN_JDK_MAJOR`）。解析顺序为「设置页 → 环境变量 → 内置默认值」，所以已有 ZCode 或 CI 环境无需改动即可继续工作。

## 工具清单

23 个工具，名称与参数与原插件一致。

| 工具 | 作用 |
|---|---|
| `android_preflight` | 检查 SDK、adb、emulator、AVD、Java、Gradle 项目状态与 UI 自动化后端，并回显当前设置 |
| `android_discover_project` | 发现 Gradle 根、模块、variant、applicationId、manifest 与 APK 产物 |
| `android_create_app` | 生成最小 Kotlin + Jetpack Compose 工程 |
| `android_build_app` | 构建指定模块/variant |
| `android_build_and_run` | 构建 → 复用或启动设备 → 安装 → 启动 |
| `android_list_devices` | 列出 adb 可见设备 |
| `android_list_avds` | 列出 AVD |
| `android_start_emulator` | 启动新的 GUI 模拟器（从不复用已有设备） |
| `android_stop_emulator` | 按序列号停止模拟器 |
| `android_create_avd` | 用 `avdmanager` 创建 AVD |
| `android_install_app` | 安装 APK |
| `android_launch_app` | 按 applicationId 启动 |
| `android_terminate_app` | 强制停止应用 |
| `android_open_url` | 在设备上打开 URL |
| `android_screenshot` | 截图并落盘；模型支持图像输入时同时返回图像 |
| `android_logs` | 读取 logcat 尾部，可按 applicationId 过滤 |
| `android_ui_status` | 报告 UI 自动化后端可用性 |
| `android_ui_describe` | 返回 UI Automator 元素树 |
| `android_ui_resolve` | 按文本/描述/资源 id/类名解析到坐标 |
| `android_ui_tap` | 坐标点击 |
| `android_ui_swipe` | 坐标滑动 |
| `android_ui_type_text` | 向聚焦控件输入文本 |
| `android_ui_keyevent` | 发送 `BACK`/`HOME`/`ENTER`/`APP_SWITCH`/`MENU`/`SEARCH` |

`android_screenshot` 的行为值得单独说明：PNG 总会写到磁盘（默认在数据目录的 `screenshots/` 下），同时尝试把图像提交给宿主的附件服务以获得规范的图像块。当前模型未声明图像输入、或部署没有附件服务时，结果会退化为纯文本并附上文件路径，而不会让整次调用失败。

## Skill 与斜杠命令

- **`android-dev` skill**：随包提供（`skills/android-dev/`），host 半侧通过 `ctx.skills.register()` 注册为嵌入式 skill，并把 skill 目录作为 `resourceBase`，因此 `INSTALL_ENVIRONMENT.md` 的相对引用照旧可用。内容已按 DSH 改写：不再有 `mcp__...` 前缀，环境配置指向设置页而非环境变量，并补充了设置页使用说明。
- **`/android-dev [目标]` 命令**：通过 `ctx.commands.register()` 注册。DSH 的用户命令刻意不产生模型消息，因此该命令做一件不依赖模型的事——跑一遍环境诊断，输出结论、失败项与修复建议，并给出下一步提示。

## 与原插件的差异

| 方面 | 原插件（ZCode） | 本插件（DSH） |
|---|---|---|
| 工具暴露 | stdio MCP 服务器 `android-emulator`，模型看到 `mcp__android_emulator__*` | 原生 `ctx.tools.register()`，模型看到 `android_*` |
| 用户配置 | `plugin.json` 的 `userConfig`，经 `ANDROID_PLUGIN_*` 注入 | 设置页 + schemastery `Config`，字段全部 `.volatile()` 实时生效；环境变量仍作回落 |
| 工作目录 | `process.cwd()` | `exec.agent.session.header.cwd`（会话工作区） |
| 数据目录 | `ANDROID_PLUGIN_DATA` / 临时目录 | `$DSH_HOME/android-emulator-helper`，可配置 |
| 截图返回 | MCP image content（base64） | host 附件引用生成的图像块，失败时退化为文本 |
| 斜杠命令 | 注入一段提示词给模型 | 直接运行诊断并输出结论 |
| 进程调用 | `node:child_process` 直接 spawn | 保持一致 |

保留直接 spawn 是有意的取舍：这样 `gradlew`、`adb`、`emulator` 的行为与原插件逐字节一致，且不必为 `adb exec-out` 的二进制流另写一层适配。代价是绕过了 DSH 的 subprocess seam——没有统一的过程管理、环境变量清洗、输出 spill 与卸载期终止。本插件的每个外部调用都有显式 timeout 与 `SIGTERM`，且不读写任何凭据环境变量。

## 架构

```
dsh-android-emulator-helper/
├── package.json            # dsh.bundle.patch、dsh.client、peer 依赖（兼容性闸门）
├── cordis.patch.yml        # - insert: [{ id: android-emulator-helper, name: '@zhz8888/dsh-android-emulator-helper' }]
├── icon.svg                # 插件图标：Android 机器人头部，品牌绿，明暗主题下都可辨认
├── locale/en.json          # 插件页的显示名与描述（英文；它的存在才是其它语言文件生效的开关）
├── locale/zh.json          # 简体中文那一份
├── lib/
│   ├── index.js            # host 半侧：注册工具 / skill / 命令 / 两个 Fetch 路由
│   ├── client.js           # browser 半侧：__ModuleLoader__ 手写 bundle，设置页
│   ├── settings.js         # 字段声明、schemastery Config（全部 .volatile()）、实时读取
│   ├── runtime.js          # 每次调用构造 runtime（会话 cwd + 实时设置 → 数据目录）
│   ├── tools/index.js      # 23 个 defineTool 定义、参数/结果 schema、图像准入
│   ├── providers/          # 从原插件逐文件移植，改为显式接收 runtime
│   └── util/               # 进程执行、路径、内容块
├── skills/android-dev/     # SKILL.md + INSTALL_ENVIRONMENT.md
├── scripts/                # check-bundle.mjs（一致性闸门）、smoke.mjs（真机集成）
└── test/                   # node:test 单元与集成测试
```

三个关键约束决定了上面的形状：

1. **设置命名空间只有一个真相来源**：profile patch 行 id。`cordis.patch.yml` 的 `id`、`lib/settings.js` 的 `SETTINGS_NAMESPACE`、`lib/client.js` 的字面量必须一致；`scripts/check-bundle.mjs` 会校验它们，也会校验 host 与 client 两份字段表无漂移。
2. **browser bundle 不能 import host 模块**（客户端纯度闸门禁止跨插件值导入），因此字段表被写了两遍，靠闸门保持一致；bundle 只能 `require` 宿主的 9 个静态模块（React、Cordis、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit` 等）。
3. **插件页的名字是包内资源，不是 manifest 字段**：DSH 通过 `exports` 解析 `<包名>/locale/en.json`，所以 `./locale/*.json` 必须保持导出、`locale` 必须留在 `files` 里；任一处缺失都会静默退化成显示原始包名。`en.json` 同时是其它语言文件的开关，因此不能只留 `zh.json`。这三条由 `test/manifest.test.js` 钉住；`scripts/check-bundle.mjs` 还会把该名字与 bundle 实际渲染的标题、导航标签按语言逐一比对，避免插件列表和设置页把同一个插件叫成两个名字。

## 开发与验证

```bash
pnpm install                 # 装官方 peer 包与 react/react-dom（开发与测试用）
pnpm test                    # 146 个测试（无需 Android SDK）
pnpm run check               # 测试 + host/client 一致性闸门 + 真实 Cordis 挂载验证
pnpm run verify:mount        # 真实 Cordis Context + 真实 ToolRuntime 注册表
pnpm run smoke               # 只读真机探测：preflight / AVD / 设备 / 项目发现 / inventory
pnpm run smoke:emulator      # 额外：启动模拟器 → 截图 → 读日志 → 停止
pnpm run link:dsh-deps       # 离线开发：把本机 DSH 的 @deepseek-ai 包软链进 node_modules
```

### 四层验证

| 层 | 命令 | 证明了什么 |
|---|---|---|
| 单元 / 解析器 | `pnpm test` | 客户端 bundle 加载契约与静态模块约束、manifest 与 patch 契约、设置投影（volatile 实时读取、环境变量回落、越界回落）、移植过来的解析器（`adb devices`、`emulator -list-avds`、UI Automator XML、`input text` 转义、APK 选择、JDK 主版本归一、无损 JSON 归一） |
| 设置页渲染 | `pnpm test`（`client-render.test.js`） | 用真实 React + `react-dom/server` 渲染整个设置页：分组/字段/字典键完整、受控输入带真实值、开关与下拉状态正确、「已覆盖/恢复默认」、两个按钮齐全、无未解析字典键，且没有暂存改动时不出现操作栏 |
| 一致性闸门 | `scripts/check-bundle.mjs` | bundle id = 包名、命名空间 = patch 行 id、host 与 client 两份字段表与分组表逐键逐序一致、每个标题/提示/占位符/选项在**两种语言下都逐字一致**、两个路由两侧一致、`locale/*.json` 两种语言键集相同、bundle 仍是经典脚本 |
| 路由集成 | `test/routes-integration.test.js` | 在**真实** Cordis `Context` 上挂载两条设置路由：真正调用 handler 并读取其 `Response`、17 个字段都以 volatile 引用形式到达、保存的设置对下一次调用立即可见、handler 出错时返回 `500` JSON 体而不是抛出、缺少可选服务时仍能挂载、dispose 后两条路由都被移除 |
| 真实宿主挂载 | `scripts/verify-mount.mjs` | 在**真实** Cordis `Context` + **真实** `ToolRuntime` 上挂载：23 个工具注册成功、**23 个工具全部经注册表实际派发**并通过参数/结果 schema 校验、错误参数被注册表拒绝、未知工具名不解析、17 个设置字段全部 volatile、dispose 后工具全部注销 |
| 真机 | `pnpm run smoke`… | 只有带 SDK、模拟器与 Gradle 的机器才能证明的部分：发现、启动与停止、截图、logcat、UI 自动化，以及真实的 `android_create_app` → 构建 → 安装 → 启动闭环 |

`pnpm run smoke` 覆盖只有真机才能证明的部分：SDK 发现、`adb`/`emulator` 实际调用、环境拼装、设置投影真正喂给 provider。
`pnpm run smoke:emulator` 进一步覆盖启动模拟器 → 截图 → 读日志 → 停止的完整链路。

### 注册表给工具层带来的两条约束

这两条约束来自真实工具注册表，手写的测试替身看不到：

- 结果必须匹配工具声明的 `output.schema`，因此两个列表工具返回
  `{ devices: [...] }` 与 `{ avds: [...] }`，而不是裸数组——注册表会以
  invalid output 拒绝裸数组。
- 结果必须是无损 JSON，注册表的快照会直接拒绝 `undefined`。而移植过来的
  provider 一律用 `undefined` 表示缺失字段（设备没有 `model`、UI 节点没有
  `bounds`、发现结果没有 Gradle 根），因此在所有工具结果唯一的必经路径上用
  `toLosslessJson()` 统一归一，而不是在 23 个 provider 里各处理一遍。

## 已知限制

- **Linux 不支持**，与原插件一致；`android_preflight` 会将其标记为不支持的宿主。
- `android_start_emulator` 永远启动新模拟器，从不复用已有目标（原插件语义）。复用请把 `serial` 传给其他工具。
- `android_create_avd` 对 `avdmanager` 的确认提示固定回答 `no`，绝不静默触发数 GB 的镜像下载；需要先自行 `sdkmanager --install`。
- UI 自动化依赖设备端 `uiautomator`；失败时 `android_ui_status` 会报告不可用，构建/运行/截图链路不受影响。
- 设置页的「已安装系统镜像」列表来自 SDK 目录扫描，而不是 `sdkmanager --list_installed`（后者在受限环境下会因创建 bin 目录失败，且输出含大量弃用提示）。
- 设置页的两条路由由插件提供、并在真实 profile 中挂载，但它们的 HTTP 响应无法在 GUI 之外验证：桌面端对每个请求做鉴权，未带浏览器会话的 `curl` 访问 `/api/android-emulator-helper/status` 会在进入 handler 之前就返回 `403 forbidden`。因此 `test/routes-integration.test.js` 改为在真实 Cordis context 上直接调用 handler。设置页的间距、暗色主题与窄屏换行仍建议在 GUI 中人工核对一次。
- `@deepseek-ai/dsh-client-ui-primitives` 在 npm 上只有 `0.0.1-rc.1`，与运行时 API 不一致；因此设置页渲染测试对 primitives 使用了忠实替身，真实 React 与 `react-dom/server` 仍是真件。
- 插件不触碰凭据：不读取、不转发任何含 key/token/secret 的环境变量。

## 版本

| 版本 | 要点 |
|---|---|
| **1.1.0** | 设置页按卡片重做并加底部粘性操作栏；两处超时改为按秒填写；修复 8 个缺陷，其中包含生成的新工程编译不过、`android_ui_type_text` 把每个 `%` 变成 `%25`、`android_ui_describe` 在 dump 失败时返回上一屏、`android_start_emulator` 传入不存在的 AVD 名却静默启动另一个模拟器。23 个工具全部在真机上实测过。 |
| 1.0.0 | 首个版本：23 个原生 `android_*` 工具、内置 `android-dev` skill 与 `/android-dev` 命令，以及设置页。 |

**升级后请重启 DSH 宿主进程。** 本包以 `link:` 软链挂载，Node 对 ESM 做进程级缓存，`lib/` 的改动在宿主重启前不会生效——否则工具仍会跑旧代码。

## 许可

[MIT](LICENSE)，版权所有 (c) 2026 zhz8888。

工具与 provider 逻辑移植自 ZCode 官方 `android-emulator` 插件（同样以 MIT 分发，
版权归 Z.ai），Kotlin/Compose 工程模板逐字保留；完整的来源说明见 [LICENSE](LICENSE) 末尾。
