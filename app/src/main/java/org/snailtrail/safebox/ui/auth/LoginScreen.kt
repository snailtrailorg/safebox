package org.snailtrail.safebox.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
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
fun LoginScreen(
    onNavigateToRegister: () -> Unit,
    onNavigateToRecovery: () -> Unit,
    onLoginSuccess: () -> Unit,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(state.isLoggedIn) {
        if (state.isLoggedIn) onLoginSuccess()
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(80.dp))
            Text("SafeBox", style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(8.dp))
            Text("加密密码管理器", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(48.dp))

            // 登录方式切换
            var selectedTab by remember { mutableIntStateOf(0) }
            TabRow(selectedTabIndex = selectedTab) {
                Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }, text = { Text("邮箱") })
                Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }, text = { Text("手机号") })
                Tab(selected = selectedTab == 2, onClick = { selectedTab = 2 }, text = { Text("Google") })
            }

            Spacer(Modifier.height(24.dp))

            when (selectedTab) {
                0 -> EmailLoginFields(viewModel, state)
                1 -> PhoneLoginFields(viewModel, state)
                2 -> GoogleLoginButton(viewModel)
            }

            if (state.error != null) {
                Spacer(Modifier.height(16.dp))
                Text(state.error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.height(16.dp))
            TextButton(onClick = onNavigateToRecovery) { Text("忘记密码？使用恢复码") }
            Spacer(Modifier.height(4.dp))
            TextButton(onClick = onNavigateToRegister) { Text("没有账号？立即注册") }
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
private fun EmailLoginFields(viewModel: LoginViewModel, state: LoginUiState) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }

    OutlinedTextField(
        value = email, onValueChange = { email = it },
        label = { Text("邮箱地址") },
        leadingIcon = { Icon(Icons.Default.Email, null) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
        singleLine = true, modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = password, onValueChange = { password = it },
        label = { Text("密码") },
        leadingIcon = { Icon(Icons.Default.Lock, null) },
        trailingIcon = {
            IconButton(onClick = { showPassword = !showPassword }) {
                Icon(if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility, null)
            }
        },
        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        singleLine = true, modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(24.dp))
    Button(
        onClick = { viewModel.loginWithEmail(email, password) },
        modifier = Modifier.fillMaxWidth().height(48.dp),
        enabled = email.isNotBlank() && password.isNotBlank() && !state.isLoading,
    ) { Text("登录") }
    if (state.isLoading) { Spacer(Modifier.height(8.dp)); CircularProgressIndicator(modifier = Modifier.size(24.dp)) }
}

@Composable
private fun PhoneLoginFields(viewModel: LoginViewModel, state: LoginUiState) {
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }

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
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = password, onValueChange = { password = it },
        label = { Text("密码") },
        leadingIcon = { Icon(Icons.Default.Lock, null) },
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        singleLine = true, modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(24.dp))
    Button(
        onClick = { viewModel.loginWithPhone(phone, code, password) },
        modifier = Modifier.fillMaxWidth().height(48.dp),
        enabled = phone.isNotBlank() && code.isNotBlank() && password.isNotBlank() && !state.isLoading,
    ) { Text("登录") }
}

@Composable
private fun GoogleLoginButton(viewModel: LoginViewModel) {
    Button(
        onClick = { viewModel.loginWithGoogle() },
        modifier = Modifier.fillMaxWidth().height(48.dp),
    ) { Text("使用 Google 账号登录") }
}
