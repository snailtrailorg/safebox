package org.snailtrail.safebox.ui.vault

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultListScreen(
    onItemClick: (Int) -> Unit,
    onAddItem: (String) -> Unit,
    onNavigateToSettings: () -> Unit,
    onLogout: () -> Unit,
    viewModel: VaultViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    var showAddMenu by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("SafeBox") },
                actions = {
                    IconButton(onClick = { viewModel.sync() }) { Icon(Icons.Default.Sync, stringResource(R.string.common_sync)) }
                    IconButton(onClick = onNavigateToSettings) { Icon(Icons.Default.Settings, stringResource(R.string.common_settings)) }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showAddMenu = true }) {
                Icon(Icons.Default.Add, stringResource(R.string.common_add))
            }
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (state.isLoading && state.items.isEmpty()) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else if (state.items.isEmpty()) {
                Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(stringResource(R.string.vault_empty_title), style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.vault_empty_hint), style = MaterialTheme.typography.bodySmall)
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    items(state.items, key = { it.did }) { item ->
                        ListItem(
                            headlineContent = { Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            supportingContent = {
                                item.description?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            },
                            leadingContent = {
                                Icon(
                                    imageVector = when (item.type) {
                                        "android" -> Icons.Default.Android
                                        "account" -> Icons.Default.AccountCircle
                                        "file" -> Icons.Default.InsertDriveFile
                                        else -> Icons.Default.Lock
                                    },
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            },
                            modifier = Modifier.clickable { onItemClick(item.did) },
                        )
                        Divider()
                    }
                }
            }

            // 下拉菜单选择添加类型
            DropdownMenu(expanded = showAddMenu, onDismissRequest = { showAddMenu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.vault_type_android)) },
                    onClick = { showAddMenu = false; onAddItem("android") },
                    leadingIcon = { Icon(Icons.Default.Android, null) },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.vault_type_account)) },
                    onClick = { showAddMenu = false; onAddItem("account") },
                    leadingIcon = { Icon(Icons.Default.AccountCircle, null) },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.vault_type_file)) },
                    onClick = { showAddMenu = false; onAddItem("file") },
                    leadingIcon = { Icon(Icons.Default.InsertDriveFile, null) },
                )
            }
        }
    }
}
