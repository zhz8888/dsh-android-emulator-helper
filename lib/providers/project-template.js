/**
 * The bundled Kotlin + Jetpack Compose project template.
 *
 * Copied verbatim from the ZCode plugin's `providers/project-template.ts`: it is
 * pure string interpolation over a fixed file list, with no runtime coupling to
 * the harness. The only Android-behavioural constants here are the AGP/Kotlin/
 * Compose versions in `libs.versions.toml`, which are pinned exactly as the
 * original shipped them so a generated project builds reproducibly offline.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/project-template
 */

import path from "node:path";

/**
 * The values a template body interpolates.
 *
 * One shape serves every file: a body that needs none of them simply ignores
 * the argument, and a body that needs one reads it by name, so the compiler
 * checks every interpolation against the fields the caller actually supplies.
 *
 * @typedef {object} TemplateInput
 * @property {string} name - the app name, used as the Gradle project name.
 * @property {string} pkg - the application id and the Kotlin package.
 * @property {number} minSdk - the generated project's `minSdk`.
 * @property {number} compileSdk - the generated project's `compileSdk`.
 * @property {number} jvmTarget - the bytecode target both compilers use.
 */

/**
 * One file of the generated project.
 *
 * @typedef {object} TemplateFile
 * @property {string} path - the absolute path the file is written to.
 * @property {(input: TemplateInput) => string} body - the file's content.
 */

/**
 * Lowest bytecode target the template will emit.
 *
 * Java 17 is the floor because AGP 8 requires a JDK 17 toolchain and the pinned
 * Kotlin release targets 17 by default.
 */
export const MIN_JVM_TARGET = 17;

/**
 * Highest bytecode target the template will emit.
 *
 * Deliberately below the newest JDK: `JavaVersion.VERSION_24` does not exist in
 * AGP 8.7, and the Kotlin release pinned here does not know `JvmTarget.JVM_24`
 * either, so a generated project naming them fails at configuration time. The
 * cap keeps a modern-only host building instead of emitting a file that cannot
 * be evaluated.
 */
export const MAX_JVM_TARGET = 21;

/**
 * Clamp a JDK major version to a bytecode target both plugins can name.
 *
 * @param {number|string|undefined} major - the JDK major the project will build with.
 * @returns {number} a target between {@link MIN_JVM_TARGET} and {@link MAX_JVM_TARGET}.
 */
export function jvmTargetFor(major) {
    const parsed = Number.parseInt(String(major ?? ""), 10);
    if (!Number.isInteger(parsed)) return MIN_JVM_TARGET;
    return Math.min(MAX_JVM_TARGET, Math.max(MIN_JVM_TARGET, parsed));
}

/**
 * Every file of the generated project, with its content.
 *
 * @param {string} root - the project's root directory.
 * @param {string} pkg - the application id and the Kotlin package.
 * @param {string | undefined} sdk - the Android SDK root, when one is known.
 * @returns {TemplateFile[]} the files to write.
 */
export function templateFiles(root, pkg, sdk) {
    const pkgDir = pkg.replaceAll(".", "/");
    return [
        { path: path.join(root, "settings.gradle.kts"), body: settings },
        { path: path.join(root, "build.gradle.kts"), body: rootBuild },
        { path: path.join(root, "gradle.properties"), body: gradleProperties },
        ...(sdk
            ? [{ path: path.join(root, "local.properties"), body: () => localProperties(sdk) }]
            : []),
        { path: path.join(root, "gradle", "libs.versions.toml"), body: versions },
        { path: path.join(root, "app", "build.gradle.kts"), body: appBuild },
        { path: path.join(root, "app", "src", "main", "AndroidManifest.xml"), body: manifest },
        { path: path.join(root, "app", "src", "main", "res", "values", "strings.xml"), body: strings },
        { path: path.join(root, "app", "src", "main", "res", "values", "styles.xml"), body: styles },
        {
            path: path.join(root, "app", "src", "main", "java", pkgDir, "MainActivity.kt"),
            body: activity,
        },
    ];
}
/**
 * @param {TemplateInput} input
 * @returns {string}
 */
function settings(input) {
    return `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${input.name}"
include(":app")
`;
}
function rootBuild() {
    return `plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
`;
}
function gradleProperties() {
    return `android.useAndroidX=true
android.nonTransitiveRClass=true
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
`;
}
/**
 * @param {string} sdk
 * @returns {string}
 */
function localProperties(sdk) {
    return `sdk.dir=${sdk.replaceAll("\\", "\\\\")}
`;
}
function versions() {
    return `[versions]
agp = "8.7.3"
kotlin = "2.0.21"
coreKtx = "1.15.0"
activityCompose = "1.9.3"
composeBom = "2024.12.01"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-compose-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-compose-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
`;
}
/**
 * @param {TemplateInput} input
 * @returns {string}
 */
function appBuild(input) {
    return `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "${input.pkg}"
    compileSdk = ${input.compileSdk}

    defaultConfig {
        applicationId = "${input.pkg}"
        minSdk = ${input.minSdk}
        targetSdk = ${input.compileSdk}
        versionCode = 1
        versionName = "1.0"
    }

    // Both halves of a Compose build must agree on the bytecode target. Without
    // these, AGP falls back to its own default (Java 8) while the Kotlin plugin
    // derives its target from whichever JDK runs Gradle, and any JDK newer than
    // the AGP release makes the two disagree:
    //
    //   'compileDebugJavaWithJavac' and 'compileDebugKotlin' have different JVM
    //   target compatibility: 1.8 and 22
    //
    // Pinning both to the same version is what makes a freshly generated project
    // build on a machine whose only JDK is newer than the template's.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_${input.jvmTarget}
        targetCompatibility = JavaVersion.VERSION_${input.jvmTarget}
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_${input.jvmTarget})
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
}
`;
}
function manifest() {
    return `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
}
/**
 * @param {TemplateInput} input
 * @returns {string}
 */
function strings(input) {
    return `<resources>
    <string name="app_name">${input.name}</string>
</resources>
`;
}
function styles() {
    return `<resources>
    <style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar" />
</resources>
`;
}
/**
 * @param {TemplateInput} input
 * @returns {string}
 */
function activity(input) {
    return `package ${input.pkg}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            App()
        }
    }
}

@Composable
fun App() {
    var count by remember { mutableIntStateOf(0) }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    text = "Hello from Android",
                    style = MaterialTheme.typography.headlineMedium,
                )
                Text(
                    text = "Count: $count",
                    modifier = Modifier.semantics { contentDescription = "countLabel" },
                    style = MaterialTheme.typography.titleLarge,
                )
                Button(
                    onClick = { count += 1 },
                    modifier = Modifier.semantics { contentDescription = "incrementButton" },
                ) {
                    Text("Increment")
                }
            }
        }
    }
}
`;
}
