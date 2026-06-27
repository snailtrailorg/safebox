package org.snailtrail.safebox.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecoveryScreen(
    onNavigateBack: () -> Unit,
    onRecoverySuccess: () -> Unit,
    viewModel: RecoveryViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(state.isSuccess) {
        if (state.isSuccess) onRecoverySuccess()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("恢复码找回") },
                navigationIcon = { IconButton(onClick = onNavigateBack) { Icon(Icons.Default.ArrowBack, "返回") } }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(48.dp))

            Text(
                "输入您保存的 12 个恢复词",
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "恢复码由注册时生成的 12 个英文单词组成，请按顺序输入，单词之间用空格分隔。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))

            var recoveryCode by remember { mutableStateOf("") }
            OutlinedTextField(
                value = recoveryCode, onValueChange = { recoveryCode = it },
                label = { Text("恢复码") },
                placeholder = { Text("word1 word2 word3 ...") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                singleLine = false, minLines = 3, maxLines = 5,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))

            var newPassword by remember { mutableStateOf("") }
            OutlinedTextField(
                value = newPassword, onValueChange = { newPassword = it },
                label = { Text("设置新密码") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )

            if (state.error != null) {
                Spacer(Modifier.height(12.dp))
                Text(state.error!!, color = MaterialTheme.colorScheme.error)
            }

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { viewModel.recover(recoveryCode, newPassword) },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                enabled = recoveryCode.isNotBlank() && newPassword.length >= 8 && !state.isLoading,
            ) { Text("恢复并设置新密码") }

            if (state.isLoading) {
                Spacer(Modifier.height(8.dp))
                CircularProgressIndicator(Modifier.size(24.dp))
            }
        }
    }
}
