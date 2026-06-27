package org.snailtrail.safebox.ui.vault

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.snailtrail.safebox.data.local.ItemEntity
import org.snailtrail.safebox.data.repository.ItemRepository
import org.snailtrail.safebox.data.repository.SyncRepository
import org.snailtrail.safebox.domain.SessionManager
import javax.inject.Inject

data class VaultUiState(
    val isLoading: Boolean = false,
    val items: List<ItemEntity> = emptyList(),
    val isSyncing: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class VaultViewModel @Inject constructor(
    private val itemRepository: ItemRepository,
    private val syncRepository: SyncRepository,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _state = MutableStateFlow(VaultUiState(isLoading = true))
    val state: StateFlow<VaultUiState> = _state.asStateFlow()

    private val uid = 1 // TODO: 从 SessionManager 获取实际 uid

    init {
        viewModelScope.launch {
            itemRepository.getUserItems(uid).collect { items ->
                _state.value = _state.value.copy(items = items, isLoading = false)
            }
        }
    }

    fun sync() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isSyncing = true)
            syncRepository.sync(uid).fold(
                onSuccess = { _state.value = _state.value.copy(isSyncing = false) },
                onFailure = { _state.value = _state.value.copy(isSyncing = false, error = it.message) },
            )
        }
    }

    fun deleteItem(did: Int) {
        viewModelScope.launch {
            itemRepository.deleteItem(did)
        }
    }
}
