package org.snailtrail.safebox;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;

import java.util.ArrayList;
import java.util.List;

public class AndroidAppIconListDialog extends IconListDialog {
    protected AndroidAppIconListDialog(Context context, int resource, Handler handler) {
        super(context, resource, handler, R.string.android_app_icon_list_dialog_title);
    }

    @Override
    protected ArrayList<IconInfo> loadIconInfos() {
        PackageManager packageManager = m_context .getPackageManager();
        List<PackageInfo> packageInfos = packageManager.getInstalledPackages(PackageManager.GET_ACTIVITIES);

        ArrayList<IconInfo> iconInfos = new ArrayList<>();

        for(PackageInfo packageInfo : packageInfos) {
            if (packageInfo.activities != null && packageInfo.applicationInfo.icon != 0) {
                String appName = packageInfo.applicationInfo.loadLabel(packageManager).toString();
                String packageName = packageInfo.packageName;
                Drawable drawable = packageInfo.applicationInfo.loadIcon(packageManager);
                IconInfo iconInfo = new IconInfo(drawable, appName, packageName);
                iconInfos.add(iconInfo);
            }
        }

        return iconInfos;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
