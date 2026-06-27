package org.snailtrail.safebox.ui.vault

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemDetailScreen(
    did: Int,
    onNavigateBack: () -> Unit,
    onEditItem: () -> Unit,
    viewModel: ItemDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(did) { viewModel.loadItem(did) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.item?.name ?: "条目详情") },
                navigationIcon = { IconButton(onClick = onNavigateBack) { Icon(Icons.Default.ArrowBack, "返回") } },
                actions = {
                    IconButton(onClick = onEditItem) { Icon(Icons.Default.Edit, "编辑") }
                }
            )
        }
    ) { padding ->
        if (state.isLoading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (state.item == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("条目不存在或已被删除")
            }
        } else {
            val item = state.item!!
            Column(
                modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 24.dp).verticalScroll(rememberScrollState()),
            ) {
                Spacer(Modifier.height(16.dp))

                // 类型标签
                AssistChip(
                    onClick = {},
                    label = {
                        Text(
                            when (item.type) {
                                "android" -> "Android 应用"
                                "account" -> "通用账户"
                                "file" -> "本地文件"
                                else -> item.type
                            }
                        )
                    },
                    leadingIcon = {
                        Icon(
                            when (item.type) {
                                "android" -> Icons.Default.Android
                                "account" -> Icons.Default.AccountCircle
                                "file" -> Icons.Default.InsertDriveFile
                                else -> Icons.Default.Lock
                            },
                            null, Modifier.size(18.dp),
                        )
                    },
                )

                Spacer(Modifier.height(24.dp))

                OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("名称", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(4.dp))
                        Text(item.name, style = MaterialTheme.typography.bodyLarge)
                    }
                }

                if (!item.description.isNullOrBlank()) {
                    Spacer(Modifier.height(12.dp))
                    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Text("描述", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(4.dp))
                            Text(item.description!!, style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                }

                // 解密后的数据字段（敏感信息）
                if (state.showSensitiveData && !state.decryptedData.isNullOrEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("敏感信息", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                TextButton(onClick = { viewModel.hideData() }) { Text("隐藏") }
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(state.decryptedData!!, style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                } else {
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = { viewModel.showData() },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("按住查看敏感信息") }
                }

                Spacer(Modifier.height(24.dp))
            }
        }
    }
}
