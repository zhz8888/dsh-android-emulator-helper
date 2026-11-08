---
name: android-dev
description: Build, run, inspect, and lightly automate Android apps in the Android Emulator or on a USB-connected device with this plugin's android_* tools.
whenToUse: Use when the user wants you to create, modify, build, run, debug, screenshot, or inspect an Android app on the desktop Android Emulator or on a USB-connected Android device.
---

# Android Dev

Use this skill when the user wants you to create, modify, build, run, debug,
screenshot, or inspect an Android app in the desktop Android Emulator or on a
USB-connected Android device.

## Tool Names

This plugin registers model-facing tools directly into DSH — there is no MCP
prefix. There are 23 of them, and every tool name and argument name is the one
the original `android-emulator` plugin used. The tools are `android_preflight`,
`android_discover_project`, `android_create_app`, `android_build_app`,
`android_build_and_run`, `android_list_devices`, `android_list_avds`,
`android_start_emulator`, `android_stop_emulator`, `android_create_avd`,
`android_install_app`, `android_launch_app`, `android_terminate_app`,
`android_open_url`, `android_screenshot`, `android_logs`, `android_ui_status`,
`android_ui_describe`, `android_ui_resolve`, `android_ui_tap`,
`android_ui_swipe`, `android_ui_type_text`, and `android_ui_keyevent`.

## Environment Requirements

`INSTALL_ENVIRONMENT.md` carries the full setup procedure; what the tools
actually need is:

- **Android SDK** — platform-tools (`adb`), the emulator, one platform and one
  build-tools release, and one system image for the API level you target. The
  SDK root comes from the configuration page's `sdkPath`, else `ANDROID_HOME`,
  `ANDROID_SDK_ROOT`, the Windows registry, the project's `local.properties`,
  then the common install paths on every drive.
- **A JDK** — the `jdkMajor` setting (17 by default) picks the one a build
  runs on. It is a preference, not a requirement: the nearest installed major
  is used when that one is missing, and the generated project's JVM target
  follows the JDK in use, clamped to 17–21.
- **Gradle** — the project's own `./gradlew` when it has one, `gradle` from
  `PATH` otherwise. A generated project ships no wrapper, so a machine with no
  global Gradle cannot build it until `android_build_app` generates one.
- **A device or an AVD** — an attached USB device, or an AVD to boot.
  `emulator` and `avdmanager` are only needed for emulator work.
- **Node.js ≥ 22** — the DSH host runtime, which the harness provides.

## Default Workflow

1. Call `android_preflight` first.
   - If the required environment is not ready, follow `INSTALL_ENVIRONMENT.md`
     (resolve it against this skill's base directory) before continuing. Missing
     emulator-only checks do not block a selected ready USB device target.
   - The checks run in a fixed order — host OS, SDK root, the effective
     settings, `adb`, `emulator`, `sdkmanager`, `avdmanager`, Java, Gradle,
     emulator acceleration (Windows only), the AVDs, then the connected
     devices — so fix the first failing check before moving on.
   - Environment setup uses the fixed macOS shell procedure or the Windows
     PowerShell 7 (`pwsh`) procedure in that file; do not improvise unrelated
     install commands. On Windows prefer `pwsh`; use `cmd.exe` only when `pwsh`
     is unavailable (plain tool invocations work there), and never the in-box
     Windows PowerShell 5.1 (`powershell.exe`).
   - Do not accept Android SDK licenses, enter passwords, wipe emulator data, or
     delete AVDs on the user's behalf. Stop and ask the user for those cases.
2. Discover the project with `android_discover_project`.
   - If no Android project exists and the user wants a new app, call
     `android_create_app`.
   - Prefer editing Kotlin/Compose files directly after project creation.
   - `android_create_app` refuses to overwrite generated files by default; only
     pass `overwrite: true` after explicit user confirmation.
   - Read `warnings` in the discovery result before building and repair missing
     `gradle.properties`, `local.properties`, or Gradle wrapper issues.
3. Build and launch with `android_build_and_run`.
   - Pass `module`, `variant`, or `applicationId` when discovery is ambiguous.
   - Use a selected `serial` when the user wants a specific USB device or
     emulator. Use `android_start_emulator` only when a new GUI emulator is
     needed, then pass its returned `serial` to follow-up tools.
   - Read the returned `output` first for compile errors; open the returned
     `logPath` only when more detail is needed.
4. Verify the app visually with `android_screenshot`.
5. For runtime checks, use `android_open_url`, `android_launch_app`,
   `android_terminate_app`, and `android_logs`.
6. For UI automation, call `android_ui_status` first.
   - Prefer `android_ui_describe` or `android_ui_resolve` before tapping
     coordinates.
   - `android_ui_describe` and `android_ui_resolve` need the device-side
     `uiautomator` binary; `android_ui_tap`, `android_ui_swipe`,
     `android_ui_type_text`, and `android_ui_keyevent` go through `adb input`
     and keep working without it. `android_ui_status` reports the two
     separately, as `uiAutomator` and `adbInput`.
   - If UI automation is unavailable, continue with build/run/screenshot checks
     and say UI automation is unavailable.

## Tool Notes

- The emulator renders in its own desktop window. Do not create or expect a
  custom emulator window.
- `android_preflight` is a pure diagnostic: it reads the machine and changes
  nothing. When it reports missing dependencies, use `INSTALL_ENVIRONMENT.md`
  for guided setup.
- The target tools accept `serial` for a specific USB device or emulator, and
  `avd` for the emulator to start when no target is ready. With neither, the
  target is the `defaultSerial` setting, then a ready emulator, then any ready
  device.
  `android_start_emulator` always starts a NEW GUI emulator and never reuses an
  existing target; it refuses to start an AVD that is already running.
- The registry refuses a call that leaves a required argument out:
  `android_create_app` needs `name`, `android_stop_emulator` needs `serial`,
  `android_install_app` needs `apkPath`, `android_launch_app` and
  `android_terminate_app` need `applicationId`, `android_open_url` needs
  `url`, `android_ui_resolve` needs `query`, `android_ui_tap` needs `x` and
  `y`, `android_ui_type_text` needs `text`, and `android_ui_keyevent` needs
  `key`. Everything else is optional.
- Keep emulator interactions inside these tools instead of raw `adb`/`emulator`
  commands unless a tool does not cover the operation.
- `android_create_app` generates a minimal Kotlin + Jetpack Compose app suitable
  for model-driven iteration. Its `compileSdk` cannot be below 35, because the
  AndroidX release the template pins requires it.
- `android_create_avd` answers `no` to `avdmanager`'s confirmation prompt, so
  it never triggers a multi-gigabyte image download on its own — install the
  system image first.
- `android_build_app` only builds. `android_build_and_run` builds, then reuses
  the selected target or starts a GUI emulator when the settings allow it,
  installs, and launches.
- `android_logs` reads the tail of logcat: `lines` defaults to the
  `logTailLines` setting (500) and is capped at 5000, and `limit` caps the
  rendered text at 20000 characters (200000 at most). An `applicationId` filter
  selects the app's own lines by PID; when no process is running, the read
  falls back to matching the id in the text and says so in `filter`/`note`.
- `android_screenshot` writes a PNG under `<data directory>/screenshots/` by
  default and returns it as an image when the current model accepts image
  input; otherwise the result names the file on disk.
- `android_ui_type_text` accepts at most 1000 characters, and
  `android_ui_swipe` needs a positive `durationMs` (300 ms by default).
- `android_install_app` and `android_screenshot` resolve their paths against
  the session workspace: a relative path works, and an absolute one is accepted
  only while it still resolves inside that workspace.
- Android SDK path, default AVD, API level, build-tools version, system image
  variant/ABI, JDK major version, emulator arguments, timeouts and output
  directories all come from the plugin's configuration page in the **Plugins**
  panel (Plugins → Installed plugins → Android Emulator Helper → **Configure**).
  `android_preflight` echoes the effective values under `settings`. Historical `ANDROID_PLUGIN_*` environment variables are still
  honoured as fallbacks for the fields that had them.

## Project Requirements

When creating or repairing a project manually, make sure these files exist
before building:

- `settings.gradle` or `settings.gradle.kts`
- root `build.gradle` or `build.gradle.kts`
- `app/build.gradle` or `app/build.gradle.kts`
- `gradle.properties` with `android.useAndroidX=true`
- `local.properties` with `sdk.dir=<Android SDK path>` when the SDK is not
  otherwise discoverable
- a Gradle wrapper (`gradlew` / `gradlew.bat`) or `gradle` available on `PATH`

## Build Troubleshooting

- If Gradle reports `android.useAndroidX property is not enabled`, create or
  update `gradle.properties` with `android.useAndroidX=true`.
- If `android_preflight` reports `Gradle` as `not found`, follow the quick
  Gradle fix in `INSTALL_ENVIRONMENT.md`; do not reinstall the Android SDK when
  Gradle is the only missing check.
- If `android_preflight` reports no AVDs but a USB device is ready, continue by
  passing that device `serial` to target tools.
- If Gradle cannot find the Android SDK, create `local.properties` in the
  Android Gradle root with `sdk.dir=<Android SDK path>`.
- If `./gradlew` or `gradlew.bat` is missing, install Gradle and run
  `gradle wrapper --gradle-version 8.9`, or let `android_build_app` attempt
  wrapper generation when `gradle` is available. The generated wrapper is
  pinned to the installed Gradle's version, never below 8.9 — the floor the
  bundled Android Gradle Plugin 8.7.3 accepts.
- If `android_create_app` refuses a `compileSdk`, it refused one below 35: the
  AndroidX release the template pins needs 35 or newer. Raise the `apiLevel`
  setting or pass `compileSdk: 35` or higher.
- If `sdkmanager` or `avdmanager` cannot find Java after installing Homebrew
  `openjdk@<configured JDK major>`, export the matching `JAVA_HOME` from
  `INSTALL_ENVIRONMENT.md` and retry. Use the optional symlink step only after
  user confirmation.
- If a build times out, raise the Gradle build timeout on the configuration page
  rather than retrying blindly; the build log path in the result has the full
  transcript.
- On Windows, if SDK package installation fails because Android SDK licenses are
  not accepted, ask the user for explicit approval before running
  `sdkmanager.bat --licenses`, then retry the same package installation command.
- On Windows, if emulator acceleration is unavailable, ask the user to enable
  virtualization/WHPX or finish the Android Emulator driver setup in Android
  Studio Device Manager, then rerun `android_preflight`.
- If system image downloads time out, prefer the `default` image first and retry
  the exact `sdkmanager --install` command with a longer timeout before
  switching to larger `google_apis` images.

## Configuration Page

The plugin's page in the **Plugins** panel (Plugins → Installed plugins →
Android Emulator Helper → **Configure**) edits the same values
`android_preflight` reports. The page's **Run diagnostic** button runs the
diagnostic in the app and shows every check with its fix hint, and **Refresh
devices and AVDs** re-reads the connected devices, AVDs, installed SDK packages
and JDKs, so the fields' suggestions offer real choices from this machine.
Prefer pointing the user there over asking them to export environment
variables. The two buttons call `GET /api/android-emulator-helper/status` and
`GET /api/android-emulator-helper/inventory` on the host.

## Extension Point

The Android backend is deliberately isolated. The current implementation uses
Android SDK tools, ADB/UI Automator, and Gradle. Future backends can map the same
public operations to Android Studio semantic tools, a UI Automator helper APK,
Appium/uiautomator2, or another automation bridge without changing this
workflow.
