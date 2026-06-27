package org.snailtrail.safebox.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF1A73E8),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD3E3FD),
    secondary = Color(0xFF5F6368),
    surface = Color(0xFFFAFAFA),
    background = Color.White,
    error = Color(0xFFD93025),
)

@Composable
fun SafeBoxTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        content = content,
    )
}
