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
import androidx.compose.ui.res.stringResource
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
                title = { Text(state.item?.name ?: stringResource(R.string.detail_title_fallback)) },
                navigationIcon = { IconButton(onClick = onNavigateBack) { Icon(Icons.Default.ArrowBack, stringResource(R.string.common_back)) } },
                actions = {
                    IconButton(onClick = onEditItem) { Icon(Icons.Default.Edit, stringResource(R.string.common_edit)) }
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
                Text(stringResource(R.string.detail_error_not_found))
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
                                "android" -> stringResource(R.string.vault_type_android)
                                "account" -> stringResource(R.string.vault_type_account)
                                "file" -> stringResource(R.string.vault_type_file)
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
                        Text(stringResource(R.string.detail_label_name), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(4.dp))
                        Text(item.name, style = MaterialTheme.typography.bodyLarge)
                    }
                }

                if (!item.description.isNullOrBlank()) {
                    Spacer(Modifier.height(12.dp))
                    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Text(stringResource(R.string.detail_label_description), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                                Text(stringResource(R.string.detail_label_sensitive_data), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                TextButton(onClick = { viewModel.hideData() }) { Text(stringResource(R.string.detail_button_hide)) }
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
                    ) { Text(stringResource(R.string.detail_button_reveal)) }
                }

                Spacer(Modifier.height(24.dp))
            }
        }
    }
}
