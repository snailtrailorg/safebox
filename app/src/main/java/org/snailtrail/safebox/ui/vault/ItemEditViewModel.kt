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
import java.security.SecureRandom
import javax.inject.Inject

data class ItemEditUiState(
    val isLoading: Boolean = true,
    val isSaving: Boolean = false,
    val isSaved: Boolean = false,
    val type: String = "account",
    val name: String = "",
    val description: String = "",
    val username: String = "",
    val password: String = "",
    val url: String = "",
    val packageName: String = "",
    val filePath: String = "",
    val error: String? = null,
)

@HiltViewModel
class ItemEditViewModel @Inject constructor(
    private val itemRepository: ItemRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(ItemEditUiState())
    val state: StateFlow<ItemEditUiState> = _state.asStateFlow()

    private var did = 0
    private var uid = 1

    fun loadItem(did: Int) {
        this.did = did
        viewModelScope.launch {
            val item = itemRepository.getItem(did)
            if (item != null) {
                // TODO: 解密 item.data JSON 并填充字段
                _state.value = _state.value.copy(
                    isLoading = false, type = item.type, name = item.name,
                    description = item.description ?: "",
                )
            } else {
                _state.value = _state.value.copy(isLoading = false)
            }
        }
    }

    fun setType(type: String) { _state.value = _state.value.copy(type = type, isLoading = false) }
    fun updateName(name: String) { _state.value = _state.value.copy(name = name) }
    fun updateDescription(desc: String) { _state.value = _state.value.copy(description = desc) }
    fun updateUsername(u: String) { _state.value = _state.value.copy(username = u) }
    fun updatePassword(p: String) { _state.value = _state.value.copy(password = p) }
    fun updateUrl(u: String) { _state.value = _state.value.copy(url = u) }
    fun updatePackageName(p: String) { _state.value = _state.value.copy(packageName = p) }
    fun updateFilePath(p: String) { _state.value = _state.value.copy(filePath = p) }

    fun generatePassword() {
        val chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*"
        val random = SecureRandom()
        val pw = (1..20).map { chars[random.nextInt(chars.length)] }.joinToString("")
        _state.value = _state.value.copy(password = pw)
    }

    fun save() {
        val s = _state.value
        viewModelScope.launch {
            _state.value = _state.value.copy(isSaving = true, error = null)

            // 构建 data JSON（TODO: 用 RSA 公钥加密）
            val dataJson = buildString {
                append("{")
                when (s.type) {
                    "android" -> append("\"package\":\"${s.packageName}\",\"username\":\"${s.username}\",\"password\":\"${s.password}\"")
                    "account" -> append("\"username\":\"${s.username}\",\"password\":\"${s.password}\",\"url\":\"${s.url}\"")
                    "file" -> append("\"path\":\"${s.filePath}\"")
                }
                append("}")
            }

            val item = ItemEntity(
                did = did,
                uid = uid,
                type = s.type,
                name = s.name,
                description = s.description,
                data = dataJson, // TODO: 加密
                updatedAt = System.currentTimeMillis(),
            )

            itemRepository.saveItem(item)
            _state.value = _state.value.copy(isSaved = true, isSaving = false)
        }
    }
}
