package org.snailtrail.safebox.ui.vault

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemEditScreen(
    did: Int,
    itemType: String,
    onNavigateBack: () -> Unit,
    onSaveSuccess: () -> Unit,
    viewModel: ItemEditViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(did) {
        if (did > 0) viewModel.loadItem(did)
        else if (itemType.isNotBlank()) viewModel.setType(itemType)
    }

    LaunchedEffect(state.isSaved) {
        if (state.isSaved) onSaveSuccess()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (did > 0) stringResource(R.string.edit_title_edit) else stringResource(R.string.edit_title_new)) },
                navigationIcon = { IconButton(onClick = onNavigateBack) { Icon(Icons.Default.ArrowBack, stringResource(R.string.common_back)) } },
                actions = {
                    IconButton(
                        onClick = { viewModel.save() },
                        enabled = !state.isSaving && state.name.isNotBlank(),
                    ) { Icon(Icons.Default.Save, stringResource(R.string.common_save)) }
                }
            )
        }
    ) { padding ->
        if (state.isLoading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 24.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Spacer(Modifier.height(16.dp))

                // 类型选择
                Text(stringResource(R.string.edit_label_type), style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = state.type == "android",
                        onClick = { viewModel.setType("android") },
                        label = { Text(stringResource(R.string.edit_type_chip_android)) },
                        leadingIcon = { Icon(Icons.Default.Android, null, Modifier.size(18.dp)) },
                    )
                    FilterChip(
                        selected = state.type == "account",
                        onClick = { viewModel.setType("account") },
                        label = { Text(stringResource(R.string.edit_type_chip_account)) },
                        leadingIcon = { Icon(Icons.Default.AccountCircle, null, Modifier.size(18.dp)) },
                    )
                    FilterChip(
                        selected = state.type == "file",
                        onClick = { viewModel.setType("file") },
                        label = { Text(stringResource(R.string.edit_type_chip_file)) },
                        leadingIcon = { Icon(Icons.Default.InsertDriveFile, null, Modifier.size(18.dp)) },
                    )
                }

                Spacer(Modifier.height(20.dp))

                OutlinedTextField(
                    value = state.name, onValueChange = { viewModel.updateName(it) },
                    label = { Text(stringResource(R.string.edit_field_name)) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = state.description, onValueChange = { viewModel.updateDescription(it) },
                    label = { Text(stringResource(R.string.edit_field_description)) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )

                // 根据类型显示不同字段
                when (state.type) {
                    "android" -> {
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = state.packageName, onValueChange = { viewModel.updatePackageName(it) },
                            label = { Text(stringResource(R.string.edit_field_package_name)) },
                            placeholder = { Text("com.example.app") },
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = state.username, onValueChange = { viewModel.updateUsername(it) },
                            label = { Text(stringResource(R.string.edit_field_username)) },
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = state.password, onValueChange = { viewModel.updatePassword(it) },
                            label = { Text(stringResource(R.string.edit_field_password)) },
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                            trailingIcon = {
                                IconButton(onClick = { viewModel.generatePassword() }) {
                                    Icon(Icons.Default.AutoAwesome, stringResource(R.string.common_generate_password))
                                }
                            },
                        )
                    }
                    "account" -> {
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = state.username, onValueChange = { viewModel.updateUsername(it) },
                            label = { Text(stringResource(R.string.edit_field_username_email)) },
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = state.password, onValueChange = { viewModel.updatePassword(it) },
                            label = { Text(stringResource(R.string.edit_field_password)) },
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                            trailingIcon = {
                                IconButton(onClick = { viewModel.generatePassword() }) {
                                    Icon(Icons.Default.AutoAwesome, stringResource(R.string.common_generate_password))
                                }
                            },
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = state.url, onValueChange = { viewModel.updateUrl(it) },
                            label = { Text(stringResource(R.string.edit_field_url)) },
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    "file" -> {
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = state.filePath, onValueChange = { viewModel.updateFilePath(it) },
                            label = { Text(stringResource(R.string.edit_field_file_path)) },
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }

                if (state.error != null) {
                    Spacer(Modifier.height(12.dp))
                    Text(state.error!!, color = MaterialTheme.colorScheme.error)
                }

                Spacer(Modifier.height(24.dp))
                Button(
                    onClick = { viewModel.save() },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    enabled = state.name.isNotBlank() && !state.isSaving,
                ) { Text(stringResource(R.string.common_save)) }

                if (state.isSaving) {
                    Spacer(Modifier.height(8.dp))
                    CircularProgressIndicator(Modifier.size(24.dp))
                }

                Spacer(Modifier.height(32.dp))
            }
        }
    }
}
