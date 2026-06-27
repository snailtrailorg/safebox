package org.snailtrail.safebox.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import org.snailtrail.safebox.ui.auth.LoginScreen
import org.snailtrail.safebox.ui.auth.RecoveryScreen
import org.snailtrail.safebox.ui.auth.RegisterScreen
import org.snailtrail.safebox.ui.settings.SettingsScreen
import org.snailtrail.safebox.ui.vault.ItemDetailScreen
import org.snailtrail.safebox.ui.vault.ItemEditScreen
import org.snailtrail.safebox.ui.vault.VaultListScreen

@Composable
fun SafeBoxNavGraph(
    navController: NavHostController,
    startDestination: String = Screen.Login.route,
) {
    NavHost(navController = navController, startDestination = startDestination) {
        composable(Screen.Login.route) {
            LoginScreen(
                onNavigateToRegister = { navController.navigate(Screen.Register.route) },
                onNavigateToRecovery = { navController.navigate(Screen.Recovery.route) },
                onLoginSuccess = {
                    navController.navigate(Screen.Vault.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
            )
        }
        composable(Screen.Register.route) {
            RegisterScreen(
                onNavigateToLogin = { navController.popBackStack() },
                onRegisterSuccess = {
                    navController.navigate(Screen.Vault.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
            )
        }
        composable(Screen.Recovery.route) {
            RecoveryScreen(
                onNavigateBack = { navController.popBackStack() },
                onRecoverySuccess = {
                    navController.navigate(Screen.Vault.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
            )
        }
        composable(Screen.Vault.route) {
            VaultListScreen(
                onItemClick = { did -> navController.navigate(Screen.ItemDetail.createRoute(did)) },
                onAddItem = { type -> navController.navigate(Screen.ItemEdit.createRoute(type = type)) },
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
        composable(
            route = Screen.ItemDetail.route,
            arguments = listOf(navArgument("did") { type = NavType.IntType })
        ) { backStackEntry ->
            val did = backStackEntry.arguments?.getInt("did") ?: return@composable
            ItemDetailScreen(
                did = did,
                onNavigateBack = { navController.popBackStack() },
                onEditItem = { navController.navigate(Screen.ItemEdit.createRoute(did = did)) },
            )
        }
        composable(
            route = Screen.ItemEdit.route,
            arguments = listOf(
                navArgument("did") { type = NavType.IntType; defaultValue = 0 },
                navArgument("type") { type = NavType.StringType; defaultValue = "" },
            )
        ) { backStackEntry ->
            val did = backStackEntry.arguments?.getInt("did") ?: 0
            val type = backStackEntry.arguments?.getString("type") ?: ""
            ItemEditScreen(
                did = did,
                itemType = type,
                onNavigateBack = { navController.popBackStack() },
                onSaveSuccess = { navController.popBackStack() },
            )
        }
        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
    }
}
