package org.snailtrail.safebox;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;

import java.util.ArrayList;
import java.util.List;

public class AndroidAppIconListDialog extends IconListDialog {
    protected AndroidAppIconListDialog(Context context, int resource, Handler handler) {
        super(context, resource, handler);
    }

    @Override
    protected ArrayList<IconInfo> loadIconInfos() {
        PackageManager packageManager = m_context .getPackageManager();
        List<PackageInfo> packgeInfos = packageManager.getInstalledPackages(0);

        ArrayList<IconInfo> iconInfos = new ArrayList<>();

        for(PackageInfo packgeInfo : packgeInfos) {
            if ((packgeInfo.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM)  == 0) {
                String appName = packgeInfo.applicationInfo.loadLabel(packageManager).toString();
                String packageName = packgeInfo.packageName;
                Drawable drawable = packgeInfo.applicationInfo.loadIcon(packageManager);
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
