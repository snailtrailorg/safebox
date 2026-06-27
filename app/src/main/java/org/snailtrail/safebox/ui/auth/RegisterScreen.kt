package org.snailtrail.safebox.ui.auth

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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegisterScreen(
    onNavigateToLogin: () -> Unit,
    onRegisterSuccess: () -> Unit,
    viewModel: RegisterViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(state.isSuccess) {
        if (state.isSuccess) onRegisterSuccess()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("注册") },
                navigationIcon = { IconButton(onClick = onNavigateToLogin) { Icon(Icons.Default.ArrowBack, "返回") } }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 24.dp).verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(16.dp))

            var selectedTab by remember { mutableIntStateOf(0) }
            TabRow(selectedTabIndex = selectedTab) {
                Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }, text = { Text("邮箱") })
                Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }, text = { Text("手机号") })
                Tab(selected = selectedTab == 2, onClick = { selectedTab = 2 }, text = { Text("Google") })
            }

            Spacer(Modifier.height(24.dp))

            var email by remember { mutableStateOf("") }
            var phone by remember { mutableStateOf("") }
            var code by remember { mutableStateOf("") }
            var password by remember { mutableStateOf("") }
            var confirmPassword by remember { mutableStateOf("") }
            var showPassword by remember { mutableStateOf(false) }

            when (selectedTab) {
                0 -> {
                    OutlinedTextField(
                        value = email, onValueChange = { email = it },
                        label = { Text("邮箱地址") },
                        leadingIcon = { Icon(Icons.Default.Email, null) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                }
                1 -> {
                    OutlinedTextField(
                        value = phone, onValueChange = { phone = it },
                        label = { Text("手机号") },
                        leadingIcon = { Icon(Icons.Default.Phone, null) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = code, onValueChange = { code = it },
                            label = { Text("验证码") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true, modifier = Modifier.weight(1f),
                        )
                        Button(
                            onClick = { viewModel.sendCode("phone", phone) },
                            enabled = phone.isNotBlank() && !state.isSendingCode,
                        ) { Text(if (state.isSendingCode) "..." else "发送") }
                    }
                }
                2 -> {
                    // Google 注册: 先用 Google Sign-In 获取 idToken
                    OutlinedButton(
                        onClick = { viewModel.registerWithGoogle() },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text("使用 Google 账号注册") }
                }
            }

            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = password, onValueChange = { password = it },
                label = { Text("设置密码") },
                leadingIcon = { Icon(Icons.Default.Lock, null) },
                trailingIcon = {
                    IconButton(onClick = { showPassword = !showPassword }) {
                        Icon(if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility, null)
                    }
                },
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                supportingText = { Text("至少 8 位，包含数字和大写字母") },
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = confirmPassword, onValueChange = { confirmPassword = it },
                label = { Text("确认密码") },
                leadingIcon = { Icon(Icons.Default.Lock, null) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                isError = confirmPassword.isNotEmpty() && password != confirmPassword,
                supportingText = {
                    if (confirmPassword.isNotEmpty() && password != confirmPassword) Text("两次密码不一致")
                },
            )

            if (state.error != null) {
                Spacer(Modifier.height(12.dp))
                Text(state.error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.height(24.dp))

            val canRegister = when (selectedTab) {
                0 -> email.isNotBlank() && password.length >= 8 && password == confirmPassword
                1 -> phone.isNotBlank() && code.isNotBlank() && password.length >= 8 && password == confirmPassword
                else -> true
            }

            Button(
                onClick = {
                    when (selectedTab) {
                        0 -> viewModel.registerWithEmail(email, password)
                        1 -> viewModel.registerWithPhone(phone, code, password)
                    }
                },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                enabled = canRegister && !state.isLoading,
            ) { Text("注册") }

            if (state.isLoading) {
                Spacer(Modifier.height(8.dp))
                CircularProgressIndicator(Modifier.size(24.dp))
            }

            // 恢复码展示
            if (state.showRecoveryCode && state.recoveryCode != null) {
                Spacer(Modifier.height(24.dp))
                RecoveryCodeCard(state.recoveryCode!!, onAcknowledged = { viewModel.acknowledgeRecoveryCode() })
            }

            Spacer(Modifier.height(16.dp))
            TextButton(onClick = onNavigateToLogin) { Text("已有账号？立即登录") }
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
fun RecoveryCodeCard(code: String, onAcknowledged: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text("⚠️ 恢复码", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Text(
                "这是您唯一的恢复凭证。如果忘记密码且丢失手机，这是找回数据的唯一方式。请立即抄写或截图保存。",
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(12.dp))
            Text(code, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(16.dp))
            Button(onClick = onAcknowledged, modifier = Modifier.fillMaxWidth()) {
                Text("我已安全保存恢复码")
            }
        }
    }
}
