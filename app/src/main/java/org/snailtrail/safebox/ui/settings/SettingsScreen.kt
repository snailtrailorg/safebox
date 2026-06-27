package org.snailtrail.safebox.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    onLogout: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(state.isLoggedOut) {
        if (state.isLoggedOut) onLogout()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置") },
                navigationIcon = { IconButton(onClick = onNavigateBack) { Icon(Icons.Default.ArrowBack, "返回") } }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()),
        ) {
            Spacer(Modifier.height(8.dp))

            // 安全
            Text("安全", style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.primary,
            )

            var showChangePassword by remember { mutableStateOf(false) }
            ListItem(
                headlineContent = { Text("修改密码") },
                leadingContent = { Icon(Icons.Default.Lock, null) },
                modifier = Modifier.clickable(onClick = { showChangePassword = true }),
            )

            ListItem(
                headlineContent = { Text("查看恢复码") },
                supportingContent = { Text("保存您的 12 词恢复码") },
                leadingContent = { Icon(Icons.Default.Key, null) },
            )

            var autoLockMinutes by remember { mutableIntStateOf(5) }
            ListItem(
                headlineContent = { Text("自动锁定") },
                supportingContent = { Text("${autoLockMinutes} 分钟无操作后自动锁定") },
                leadingContent = { Icon(Icons.Default.Timer, null) },
            )

            Divider()

            // 数据
            Text("数据", style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.primary,
            )

            ListItem(
                headlineContent = { Text("导出加密备份") },
                leadingContent = { Icon(Icons.Default.Upload, null) },
            )

            ListItem(
                headlineContent = { Text("导入备份") },
                leadingContent = { Icon(Icons.Default.Download, null) },
            )

            ListItem(
                headlineContent = { Text("立即同步") },
                leadingContent = { Icon(Icons.Default.Sync, null) },
                modifier = Modifier.clickable(onClick = { viewModel.syncNow() }),
            )

            Divider()

            // 账户
            Text("账户", style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.primary,
            )

            ListItem(
                headlineContent = { Text("退出登录") },
                leadingContent = { Icon(Icons.Default.Logout, null, tint = MaterialTheme.colorScheme.error) },
                modifier = Modifier.clickable(onClick = { viewModel.logout() }),
            )

            Spacer(Modifier.height(16.dp))

            // 版本信息
            Text(
                "SafeBox v2.0.0\nPowered by SnailTrail.ORG",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
            Spacer(Modifier.height(32.dp))
        }
    }
}