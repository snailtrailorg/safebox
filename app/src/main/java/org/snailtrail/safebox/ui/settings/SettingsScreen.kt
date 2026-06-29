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
import androidx.compose.ui.res.stringResource
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
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = { IconButton(onClick = onNavigateBack) { Icon(Icons.Default.ArrowBack, stringResource(R.string.common_back)) } }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()),
        ) {
            Spacer(Modifier.height(8.dp))

            // 安全
            Text(stringResource(R.string.settings_section_security), style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.primary,
            )

            var showChangePassword by remember { mutableStateOf(false) }
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_item_change_password)) },
                leadingContent = { Icon(Icons.Default.Lock, null) },
                modifier = Modifier.clickable(onClick = { showChangePassword = true }),
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_item_view_recovery_code)) },
                supportingContent = { Text(stringResource(R.string.settings_item_recovery_code_hint)) },
                leadingContent = { Icon(Icons.Default.Key, null) },
            )

            var autoLockMinutes by remember { mutableIntStateOf(5) }
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_item_auto_lock)) },
                supportingContent = { Text(stringResource(R.string.settings_item_auto_lock_detail, autoLockMinutes)) },
                leadingContent = { Icon(Icons.Default.Timer, null) },
            )

            Divider()

            // 数据
            Text(stringResource(R.string.settings_section_data), style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.primary,
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_item_export_backup)) },
                leadingContent = { Icon(Icons.Default.Upload, null) },
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_item_import_backup)) },
                leadingContent = { Icon(Icons.Default.Download, null) },
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_item_sync_now)) },
                leadingContent = { Icon(Icons.Default.Sync, null) },
                modifier = Modifier.clickable(onClick = { viewModel.syncNow() }),
            )

            Divider()

            // 账户
            Text(stringResource(R.string.settings_section_account), style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.primary,
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_item_logout)) },
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
