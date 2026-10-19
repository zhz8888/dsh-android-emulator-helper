# dsh-android-emulator-helper

[English](README.md) | **简体中文**

[![npm version](https://img.shields.io/npm/v/@zhz8888/dsh-android-emulator-helper.svg)](https://www.npmjs.com/package/@zhz8888/dsh-android-emulator-helper)
[![license: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![target: DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-blue.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

把 ZCode 官方 `android-emulator@0.1.0` 插件移植为 **DSH（DeepSeek Harness）原生插件**：原有 23 个 MCP 工具全部保留为 DSH 原生工具，并新增一个**参数表单**，渲染在「插件」页该插件的详情页里（插件 → 已安装插件 → Android 模拟器助手），让 SDK、模拟器、系统镜像、构建与输出目录等参数在应用里配置，而不是靠环境变量。

- 工具名、参数名与原插件完全一致，为原 `android_emulator` MCP 服务器写的工作流可直接迁移；这次移植既不新增工具，也不删除工具。
- 5 组 17 个设置项，全部实时生效；原插件暴露的 7 个字段仍会回落到同名 `ANDROID_PLUGIN_*` 变量，再回落到内置默认值。
- `android_preflight` 与参数页的 **检测环境** 按钮跑同一套检查——SDK、`adb`、`emulator`、AVD、JDK、Gradle——并逐条给出修复建议。
- 包名为 `@zhz8888/dsh-android-emulator-helper`；插件页显示的是 `locale/` 里的本地化名称 **Android Emulator Helper** / **Android 模拟器助手**，而不是原始包名，两条描述都写明本插件非官方、与 Google 无隶属关系。

## 快速上手

在一台装有 Android SDK、JDK 与 DSH 的机器上：

1. **安装插件**

   ```bash
   dsh plugin --profile <profile> add @zhz8888/dsh-android-emulator-helper
   ```

   DSH Desktop 则在 **插件** 页里添加同一个包名。装完重载或重启 DSH。

2. **检查本机环境** —— 打开 **插件 → 已安装插件 → Android 模拟器助手**，点 **检测环境**。它跑的就是 `android_preflight` 那套检查，缺什么都会给出修复建议。

3. **开始使用** —— 直接说你要什么（「把这个工程在模拟器上构建并运行」「给跑起来的应用截个图」），或直接调用 23 个 `android_*` 工具。工具需要的参数都能在那个页面里改。

## 目录

- [快速上手](#快速上手)
- [环境要求](#环境要求)
- [安装](#安装)
- [配置页面](#配置页面)
- [配置页截图](#配置页截图)
- [工具清单](#工具清单)
- [Skill 与斜杠命令](#skill-与斜杠命令)
- [与原插件的差异](#与原插件的差异)
- [已知限制](#已知限制)
- [版本与发布](#版本与发布)
- [参与贡献](#参与贡献)
- [许可](#许可)

## 环境要求

| 依赖 | 说明 |
|---|---|
| Android SDK | 插件配置页的 `sdkPath`，留空则依次探测 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 与常见安装路径。 |
| platform-tools、emulator 与系统镜像 | `adb` 与 `emulator` 来自 SDK；创建 AVD 需要与目标 API 级别匹配的系统镜像。 |
| JDK | `jdkMajor`（默认 `17`）决定构建用哪个 JDK；生成工程的 JVM target 由它推导并钳制在 [17, 21]。 |
| Gradle | `android_build_app` 优先用工程自带的 `./gradlew`，没有就用 `PATH` 里的 `gradle`（也能用后者生成 wrapper）。而 `android_create_app` 生成的工程不带 wrapper。 |
| 一台设备或一个 AVD | 已连接设备，或一个可启动的 AVD；`autoStartEmulator` 决定工具能否自行启动模拟器。 |
| Node.js ≥ 22 | DSH 宿主运行时。 |

`android_preflight` 会逐项检查上表并给出修复建议；插件页的 **检测环境** 按钮跑的是同一套检查。

## 安装

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-android-emulator-helper
```

**DSH Desktop**：`desktop` profile 由 Electron 应用独占管理——请在 **插件** 页里添加 `@zhz8888/dsh-android-emulator-helper`，并启用它创建的那一行。重载或重启后，打开 **插件 → 已安装插件 → Android 模拟器助手**：参数表单就在该插件的详情页里，且只有当 host 半侧真正提供该设置命名空间时它才会出现。

发布包内含插件需要的一切——host 半侧、浏览器 bundle、内置 skill 与 `locale/` 词条——且安装期不编译任何东西，因此没有构建审批环节。`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 都是**由宿主提供的 peer 依赖**，插件不会带入第二份副本，本身**没有任何运行时依赖**；DSH 的兼容性闸门会拿 `@deepseek-ai/dsh*` 的 peer 区间与运行版本比对，不匹配直接拒装。

> 同一个包只能挂载一次。`dsh plugin add` 会把这一行记进 `dsh.profile.bundles`；再往 profile 自己的 `cordis.patch.yml` 里手加同一行，会让所有工具名二次注册并在加载期报错。

### 升级与卸载

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-android-emulator-helper@latest   # 升级
dsh plugin --profile <profile> remove @zhz8888/dsh-android-emulator-helper      # 卸载
```

设置保存在 profile 里而不是包里，所以这两条命令都不会动它。数据目录（默认 `$DSH_HOME/android-emulator-helper`，其次 `~/.dsh/android-emulator-helper`）存放截图与构建日志，卸载不会删除它，是否清理由你决定。

### 版本闸门

DSH 兼容范围是 **`>=0.2.0-rc.2`——只有下界，没有上界**，三处声明逐字一致（`peerDependencies`、`engines.dsh`、`dsh.compatibility.dsh`）：低于下界的运行时会**直接拒绝安装**，同时未来的稳定版都不会被排除。

只有一个 node-semver 细节绕不开：`0.2.1-alpha.1` 这类**新元组的预发布**在 npm/pnpm 的默认规则下不被放行，安装会失败。此时二选一——给范围补一条该元组的分支（`">=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-0"`），或让 pnpm 放宽 peer 校验：

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-android-emulator-helper \
  --config.strict-peer-dependencies=false
```

稳定版（`0.2.0`、`0.2.1`、`0.3.0`、`1.0.0`…）不受这个细节影响，一律放行。

## 配置页面

配置命名空间 = profile patch 行 id = `android-emulator-helper`（同时是 `dsh.name`）。表单注册到插件页的 `plugins.bundle.config` 槽、以包名为键，因此渲染在「插件」页该插件的详情页里，而不是「设置」对话框里；只有当 host 半侧提供该命名空间时它才存在。表单通过 `ctx.configForms` 读写，因此暂存编辑、脏值检测、内联校验、乐观并发（revision）与「已覆盖 / 恢复默认」语义都由 harness 提供。详情页负责绘制插件标题、图标与描述；表单本身只贡献一行「改动何时生效」的说明、每个分组一张卡片——卡片描边就是分组之间的分隔——以及底部粘性保存栏；保存栏只在有可操作内容时出现：有暂存改动、正在写入，或一次失败值得重试。

| 分组 | 设置项 | 类型 | 默认值 | 旧环境变量回落 |
|---|---|---|---|---|
| SDK 与工具链 | `sdkPath` | 文本 | 空（自动探测） | `ANDROID_PLUGIN_SDK_PATH` |
| | `jdkMajor` | 文本，建议来自本机 | `17` | `ANDROID_PLUGIN_JDK_MAJOR` |
| | `buildToolsVersion` | 文本，建议来自本机 | `35.0.0` | `ANDROID_PLUGIN_BUILD_TOOLS_VERSION` |
| 模拟器与设备 | `defaultAvd` | 文本，建议来自本机 | `medium_phone` | `ANDROID_PLUGIN_DEFAULT_AVD` |
| | `defaultSerial` | 文本，建议来自本机 | 空 | — |
| | `autoStartEmulator` | 开关 | 开 | — |
| | `emulatorArgs` | 多行文本，每行一个参数 | 空 | — |
| | `bootTimeoutSeconds` | 整数 | `180` | — |
| API 与系统镜像 | `apiLevel` | 文本，建议来自本机 | `35` | `ANDROID_PLUGIN_API_LEVEL` |
| | `systemImageVariant` | 下拉 | `default` | `ANDROID_PLUGIN_SYSTEM_IMAGE_VARIANT` |
| | `systemImageAbi` | 下拉（留空 = 宿主架构） | 自动 | `ANDROID_PLUGIN_SYSTEM_IMAGE_ABI` |
| | `minSdk` | 整数 | `23` | — |
| 构建 | `buildTimeoutSeconds` | 整数 | `600` | — |
| | `gradleExtraArgs` | 多行文本 | 空 | — |
| 输出目录与日志 | `dataDir` | 文本 | `$DSH_HOME/android-emulator-helper` | — |
| | `screenshotDir` | 文本 | `<数据目录>/screenshots` | — |
| | `logTailLines` | 整数 | `500` | — |

配置页的两个按钮调用 host 半侧的两个精确 Fetch 路由：

- **检测环境** → `GET /api/android-emulator-helper/status`，返回与 `android_preflight` 相同的检查结果，逐条显示状态、详情与修复建议。
- **刷新设备与 AVD** → `GET /api/android-emulator-helper/inventory`，探测 SDK 根目录、AVD、已连接设备、已安装 JDK、已装系统镜像/platform/build-tools，用于填充上方字段的建议列表。

### 兼容旧配置

原插件的 `userConfig`——也就是上表最后一列的 7 个变量——仍会作为回落生效，所以已有的 ZCode 或 CI 环境无需改动：解析顺序为配置页 → 环境变量 → 内置默认值。原插件的数据目录读的是 `ANDROID_PLUGIN_DATA`；在本插件里，这个目录就是配置页的 `dataDir` 字段。

## 配置页截图

四张都是 DSH harness 0.2.1-rc.2 里真实页面按滚动顺序的实拍，没有任何拼凑。1598 × 1588 PNG，对应收紧后的卡片节奏（每个字段上下各 7px，卡片 `12px 16px`，卡片之间 16px）；截图时是中文语言，**插件** 面板停留在该插件的详情页：第一张从插件标题 **Android 模拟器助手** 与描述开始，侧边栏高亮 **插件**，而上表里的字段 key 两种语言下完全一致。灰色文字是留空字段的占位提示；底部保存条只在有改动待保存时出现，因此这几张图里没有它。

**1. SDK 与工具链** —— 页面开头是插件标题、包名与描述，然后是每次 `android_*` 调用最先解析的 SDK 根目录、JDK 主版本与 build-tools 版本，以及模拟器与设备卡片直到启动超时：

![DSH 插件面板里的 Android 模拟器助手页：插件标题与描述，接着是 SDK 与工具链卡片里的 Android SDK 根目录、JDK 主版本与 Build-tools 版本，然后是模拟器与设备卡片直到启动超时](https://raw.githubusercontent.com/zhz8888/dsh-android-emulator-helper/main/assets/settings-page-1-sdk-and-toolchain.png)

**2. 模拟器与设备** —— 调用打到哪台设备、模拟器怎么起来：默认 AVD、默认设备序列号、自动启动开关、额外 `emulator` 参数与启动超时，然后是 API 级别卡片：

![页面滚动到模拟器与设备卡片：默认 AVD、默认设备序列号、自动启动模拟器开关、额外 emulator 参数与模拟器启动超时，然后是 API 级别卡片开头的 Android API 级别](https://raw.githubusercontent.com/zhz8888/dsh-android-emulator-helper/main/assets/settings-page-2-emulator-and-devices.png)

**3. API 级别与构建** —— 生成项目与安装系统镜像的目标、`gradle` 的超时与附加参数，然后是输出卡片的开头：

![页面继续向下滚动：API 级别与系统镜像卡片里的系统镜像变体、系统镜像 ABI 与默认 minSdk，构建卡片里的 Gradle 构建超时与额外 Gradle 参数，然后是输出卡片开头的数据目录](https://raw.githubusercontent.com/zhz8888/dsh-android-emulator-helper/main/assets/settings-page-3-api-and-build.png)

**4. 输出目录与检测** —— 截图和构建日志落在哪里，以及支撑页面的两个按钮（对应上面的 Fetch 路由）；画面停在插件表单结束处：

![表单底部：输出目录与日志卡片里的数据目录、截图目录与默认 logcat 行数，然后是环境检测与探测卡片里的检测环境与刷新设备与 AVD 按钮](https://raw.githubusercontent.com/zhz8888/dsh-android-emulator-helper/main/assets/settings-page-4-output-and-diagnostics.png)

`screenshots.json` 就在仓库里的 `package.json` 旁边按这个顺序列出四张图，插件市场据此展示。

## 工具清单

23 个工具，名称与参数与原 MCP 服务器一致。

| 工具 | 作用 |
|---|---|
| `android_preflight` | 检查 SDK、`adb`、`emulator`、AVD、Java、Gradle 工程状态与 UI 自动化后端，并回显当前设置。 |
| `android_discover_project` | 发现 Gradle 根、模块、variant、applicationId、manifest 与 APK 产物。 |
| `android_create_app` | 生成最小 Kotlin + Jetpack Compose 工程。 |
| `android_build_app` | 用 Gradle 构建指定模块与 variant。 |
| `android_build_and_run` | 构建 → 复用或启动设备 → 安装 → 启动。 |
| `android_list_devices` / `android_list_avds` | 列出 adb 可见设备 / 本机 AVD。 |
| `android_start_emulator` / `android_stop_emulator` | 启动新的 GUI 模拟器 / 按序列号停止模拟器。 |
| `android_create_avd` | 用 `avdmanager` 创建 AVD。 |
| `android_install_app` / `android_launch_app` / `android_terminate_app` | 安装 APK / 按 applicationId 启动 / 强制停止应用。 |
| `android_open_url` | 在设备上打开 URL。 |
| `android_screenshot` | 截图并落盘；模型支持图像输入时同时返回图像。 |
| `android_logs` | 读取 logcat 尾部，可按 applicationId 过滤。 |
| `android_ui_status` | 报告 UI 自动化后端可用性。 |
| `android_ui_describe` / `android_ui_resolve` | 返回 UI Automator 元素树 / 按文本、描述、资源 id 或类名解析到坐标。 |
| `android_ui_tap` / `android_ui_swipe` / `android_ui_type_text` / `android_ui_keyevent` | 基于 adb 的点击、滑动、文本输入与按键事件。 |

`android_screenshot` 的行为值得单独说明：PNG 总会写到磁盘（默认在数据目录的 `screenshots/` 下），同时尝试把图像提交给宿主的附件服务以获得规范的图像块。当前模型未声明图像输入、或部署没有附件服务时，结果会退化为纯文本并附上文件路径，而不会让整次调用失败。

## Skill 与斜杠命令

- **`android-dev` skill** —— 随包提供（`skills/android-dev/`），host 半侧通过 `ctx.skills.register()` 注册为嵌入式 skill，并把 skill 目录作为 `resourceBase`，因此 `INSTALL_ENVIRONMENT.md` 的相对引用照旧可用。内容已按 DSH 改写：不再有 `mcp__…` 前缀，环境配置指向插件配置页而不是环境变量。
- **`/android-dev [目标]` 命令** —— 通过 `ctx.commands.register()` 注册。DSH 的用户命令刻意不产生模型消息，因此该命令做一件不依赖模型的事：跑一遍环境诊断，输出结论、失败项与修复建议。

## 与原插件的差异

| 方面 | 原插件（ZCode） | 本插件（DSH） |
|---|---|---|
| 工具暴露 | stdio MCP 服务器 `android-emulator`；模型看到 `mcp__android_emulator__*` | 原生 `ctx.tools.register()`；模型看到 `android_*` |
| 用户配置 | `plugin.json` 的 `userConfig`（7 项），经环境变量注入 | 配置页 + schemastery `Config` 的 17 个字段，全部 `.volatile()`；旧环境变量仍作回落 |
| 工作目录 | `process.cwd()` | `exec.agent.session.header.cwd`（会话工作区） |
| 数据目录 | `ANDROID_PLUGIN_DATA` / 临时目录 | `$DSH_HOME/android-emulator-helper`，可在配置页配置 |
| 截图返回 | MCP image content（base64） | 由 host 附件引用生成的图像块，被拒时退化为文本 + 磁盘路径 |
| 结果归一 | provider 返回含 `undefined` 的对象 | 所有结果都过一遍 `toLosslessJson()`（注册表拒绝 `undefined`） |
| 斜杠命令 | 向模型对话注入一段提示词 | 直接运行诊断并输出结论 |
| 进程调用 | `node:child_process` 直接 spawn | 保持一致 |

保留直接 spawn 是有意的取舍：这样 `gradlew`、`adb`、`emulator` 的行为与原插件逐字节一致，也不必为 `adb exec-out` 的二进制流另写适配层；代价是绕过了 DSH 的 subprocess seam，因此每个外部调用都自带 timeout 与 `SIGTERM`。插件不读取、不转发任何含凭据的环境变量。

## 已知限制

- **Linux 不支持**，与原插件一致；`android_preflight` 会明确报告。
- `android_start_emulator` 永远启动新模拟器，从不复用已有目标（原插件语义）。复用请把 `serial` 传给其他工具。
- `android_create_avd` 对 `avdmanager` 的确认提示固定回答 `no`，绝不静默触发数 GB 的镜像下载；请先用 `sdkmanager` 装好镜像。
- UI 自动化依赖设备端的 `uiautomator`；不可用时 `android_ui_status` 会报告，构建 / 运行 / 截图链路不受影响。
- 配置页的「已安装系统镜像」列表来自 SDK 目录扫描，而不是 `sdkmanager --list_installed`（后者在受限环境下会失败，且输出夹带大量弃用提示）。
- 配置页的两条路由由插件提供并在真实 profile 中挂载，但它们的 HTTP 响应无法在 GUI 之外验证：桌面端对每个请求做鉴权，未带浏览器会话的 `curl` 访问 `/api/android-emulator-helper/status` 会在进入 handler 之前返回 `403 forbidden`。配置页的间距、暗色主题与窄屏换行仍建议在 GUI 中人工核对。
- 插件不触碰凭据：不读取、不转发任何含 key/token/secret 的环境变量。

## 版本与发布

每次发布都是同一个提交出现在两处：在 `main` 上打 `vX.Y.Z` 轻量 tag，并从该 tag 发布到 npm，npm 记录的 `gitHead` 就是它的 SHA。完整列表见 [Releases](https://github.com/zhz8888/dsh-android-emulator-helper/releases)——最新是 [`v1.1.2`](https://github.com/zhz8888/dsh-android-emulator-helper/releases/tag/v1.1.2)，之前是 [`v1.1.1`](https://github.com/zhz8888/dsh-android-emulator-helper/releases/tag/v1.1.1)、[`v1.1.0`](https://github.com/zhz8888/dsh-android-emulator-helper/releases/tag/v1.1.0) 与 [`v1.0.0`](https://github.com/zhz8888/dsh-android-emulator-helper/releases/tag/v1.0.0)。

**升级后请重启 DSH 宿主进程。** 本包以 `link:` 软链挂载，Node 对 ESM 做进程级缓存，`lib/` 的改动在宿主重启前不会生效——否则工具仍会跑旧代码。

## 参与贡献

欢迎在 [github.com/zhz8888/dsh-android-emulator-helper](https://github.com/zhz8888/dsh-android-emulator-helper/issues) 提 issue 或 PR。任何改动都必须让 `pnpm check` 保持全绿——单元测试、host/client 一致性闸门、以及在真实 Cordis 宿主上的挂载验证；没有 CLA，也没有需要填的表单：一个说清楚改了什么、为什么改的聚焦 PR 就够了。

本包按 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 市场的形态组织。开发约定——命令、仓库结构、不变式、测试、提交与发布规则——都在 [AGENTS.md](AGENTS.md)。

## 许可

[MIT](LICENSE)，版权所有 (c) 2026 zhz8888。工具定义、provider 逻辑与生成的 Kotlin/Compose 工程模板移植自 ZCode 官方 `android-emulator` 插件（同样以 MIT 分发，版权归 Z.ai），模板源文件逐字保留；完整的来源说明见 [LICENSE](LICENSE) 末尾。
