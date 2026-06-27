package org.snailtrail.safebox.ui.navigation

sealed class Screen(val route: String) {
    data object Login : Screen("login")
    data object Register : Screen("register")
    data object Recovery : Screen("recovery")
    data object Vault : Screen("vault")
    data object ItemDetail : Screen("item_detail/{did}") {
        fun createRoute(did: Int) = "item_detail/$did"
    }
    data object ItemEdit : Screen("item_edit?did={did}&type={type}") {
        fun createRoute(did: Int = 0, type: String = "") =
            "item_edit?did=$did&type=$type"
    }
    data object Settings : Screen("settings")
}
