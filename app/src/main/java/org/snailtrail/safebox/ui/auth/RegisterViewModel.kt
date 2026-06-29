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

data class RegisterUiState(
    val isLoading: Boolean = false,
    val isSendingCode: Boolean = false,
    val isSuccess: Boolean = false,
    val error: String? = null,
    val showRecoveryCode: Boolean = false,
    val recoveryCode: String? = null,
)

@HiltViewModel
class RegisterViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(RegisterUiState())
    val state: StateFlow<RegisterUiState> = _state.asStateFlow()

    private var pendingRecoveryCode: String? = null

    fun registerWithEmail(email: String, password: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            // TODO: 获取设备名
            authRepository.registerWithEmail(email, password, null).fold(
                onSuccess = {
                    // 需要从 KeyManager 获取恢复码展示给用户
                    // 当前简化处理
                    _state.value = _state.value.copy(isSuccess = true, isLoading = false)
                },
                onFailure = {
                    _state.value = _state.value.copy(error = it.message, isLoading = false)
                },
            )
        }
    }

    fun registerWithPhone(phone: String, code: String, password: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            // TODO: 实现手机号注册
            _state.value = _state.value.copy(error = "Phone registration not yet implemented", isLoading = false)
        }
    }

    fun registerWithGoogle() {
        // TODO: Google Sign-In
    }

    fun sendCode(target: String, value: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isSendingCode = true)
            authRepository.sendVerificationCode(target, value)
            _state.value = _state.value.copy(isSendingCode = false)
        }
    }

    fun acknowledgeRecoveryCode() {
        _state.value = _state.value.copy(showRecoveryCode = false)
    }
}
