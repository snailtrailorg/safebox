package org.snailtrail.safebox.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.snailtrail.safebox.data.repository.AuthRepository
import javax.inject.Inject

data class LoginUiState(
    val isLoading: Boolean = false,
    val isSendingCode: Boolean = false,
    val isLoggedIn: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun loginWithEmail(email: String, password: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            authRepository.loginWithEmail(email, password).fold(
                onSuccess = { _state.value = _state.value.copy(isLoggedIn = true, isLoading = false) },
                onFailure = { _state.value = _state.value.copy(error = it.message, isLoading = false) },
            )
        }
    }

    fun loginWithPhone(phone: String, code: String, password: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            authRepository.loginWithPhone(phone, code, password).fold(
                onSuccess = { _state.value = _state.value.copy(isLoggedIn = true, isLoading = false) },
                onFailure = { _state.value = _state.value.copy(error = it.message, isLoading = false) },
            )
        }
    }

    fun loginWithGoogle() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            // Google OAuth 需要在 Activity 层启动 Google Sign-In intent
            // 这里先放占位
            _state.value = _state.value.copy(error = "Google 登录需要 Google Play Services", isLoading = false)
        }
    }

    fun sendCode(target: String, value: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isSendingCode = true)
            authRepository.sendVerificationCode(target, value)
            _state.value = _state.value.copy(isSendingCode = false)
        }
    }
}
