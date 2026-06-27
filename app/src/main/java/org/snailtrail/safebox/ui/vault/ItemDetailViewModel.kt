package org.snailtrail.safebox.ui.vault

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.snailtrail.safebox.data.local.ItemEntity
import org.snailtrail.safebox.data.repository.ItemRepository
import javax.inject.Inject

data class ItemDetailUiState(
    val isLoading: Boolean = true,
    val item: ItemEntity? = null,
    val showSensitiveData: Boolean = false,
    val decryptedData: String? = null,
)

@HiltViewModel
class ItemDetailViewModel @Inject constructor(
    private val itemRepository: ItemRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(ItemDetailUiState())
    val state: StateFlow<ItemDetailUiState> = _state.asStateFlow()

    fun loadItem(did: Int) {
        viewModelScope.launch {
            val item = itemRepository.getItem(did)
            _state.value = _state.value.copy(item = item, isLoading = false)
        }
    }

    fun showData() {
        val item = _state.value.item ?: return
        // TODO: 用 KeyManager.rsaDecrypt 解密 item.data
        _state.value = _state.value.copy(showSensitiveData = true, decryptedData = item.data)
    }

    fun hideData() {
        _state.value = _state.value.copy(showSensitiveData = false, decryptedData = null)
    }
}
