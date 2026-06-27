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

data class RecoveryUiState(
    val isLoading: Boolean = false,
    val isSuccess: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class RecoveryViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(RecoveryUiState())
    val state: StateFlow<RecoveryUiState> = _state.asStateFlow()

    fun recover(recoveryCode: String, newPassword: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            authRepository.recoverWithRecoveryCode(recoveryCode).fold(
                onSuccess = { _state.value = _state.value.copy(isSuccess = true, isLoading = false) },
                onFailure = { _state.value = _state.value.copy(error = it.message, isLoading = false) },
            )
        }
    }
}
