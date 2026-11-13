plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.cndide"
version = "0.2.0"

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        // Targets the shared platform: works in IntelliJ IDEA and other IntelliJ-based IDEs
        intellijIdeaCommunity("2024.2")
        instrumentationTools()
    }
}

kotlin { jvmToolchain(21) }

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild = "242"
            untilBuild = provider { null }
        }
    }
}
