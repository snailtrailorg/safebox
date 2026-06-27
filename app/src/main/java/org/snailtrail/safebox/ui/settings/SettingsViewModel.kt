package org.snailtrail.safebox.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.snailtrail.safebox.data.repository.AuthRepository
import javax.inject.Inject

data class SettingsUiState(
    val isLoggedOut: Boolean = false,
    val isSyncing: Boolean = false,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
            _state.value = _state.value.copy(isLoggedOut = true)
        }
    }

    fun syncNow() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isSyncing = true)
            // TODO: 触发同步
            _state.value = _state.value.copy(isSyncing = false)
        }
    }
}
