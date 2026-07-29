::带解压命令自行解压，自己按解析器开发指南自己开发，或者自己提前解压好

@echo off
setlocal enabledelayedexpansion
title ��ˢ�ű� [����ѡ�д���,����ס���Ҽ���س��ָ�]
echo ������ ^<waiting for any device^> ������Ѱ������!
bin\Windows\fastboot getvar product 2>&1 | findstr /r /c:"^product: *munch" || echo ��ƥ����豸!
bin\Windows\fastboot getvar product 2>&1 | findstr /r /c:"^product: *munch" || exit /B 1
:MENU
if not exist bin\Windows (
   echo δ��ѹ! ����ȫ��ѹ!
   pause
   exit
)
cls

if exist super.zst (
   echo ����ת�� super.zst Ϊ super.img, ���Ժ�...
   bin\Windows\zstd.exe --rm -d super.zst -o super.img
   if "%ERRORLEVEL%" neq "0" (
      echo ת��ʧ�ܣ�
      pause
      exit
   )
)
cls

bin\Windows\fastboot flash abl_ab "firmware-update/abl.img" 
bin\Windows\fastboot flash aop_ab "firmware-update/aop.img" 
bin\Windows\fastboot flash bluetooth_ab "firmware-update/bluetooth.img"
bin\Windows\fastboot flash boot_ab "boot.img"
bin\Windows\fastboot flash cmnlib_ab "firmware-update/cmnlib.img"
bin\Windows\fastboot flash cmnlib64_ab "firmware-update/cmnlib64.img"
bin\Windows\fastboot flash devcfg_ab "firmware-update/devcfg.img"
bin\Windows\fastboot flash dsp_ab "firmware-update/dsp.img"
bin\Windows\fastboot flash dtbo_ab "firmware-update/dtbo.img"
bin\Windows\fastboot flash featenabler_ab "firmware-update/featenabler.img"
bin\Windows\fastboot flash hyp_ab "firmware-update/hyp.img"
bin\Windows\fastboot flash imagefv_ab "firmware-update/imagefv.img"
bin\Windows\fastboot flash keymaster_ab "firmware-update/keymaster.img"
bin\Windows\fastboot flash modem_ab "firmware-update/modem.img"
bin\Windows\fastboot flash qupfw_ab "firmware-update/qupfw.img"
bin\Windows\fastboot flash tz_ab "firmware-update/tz.img"
bin\Windows\fastboot flash uefisecapp_ab "firmware-update/uefisecapp.img"
bin\Windows\fastboot flash vbmeta_ab "firmware-update/vbmeta.img"
bin\Windows\fastboot flash vbmeta_system_ab "firmware-update/vbmeta_system.img"
bin\Windows\fastboot flash vendor_boot_ab "firmware-update/vendor_boot.img"
bin\Windows\fastboot flash xbl_ab "firmware-update/xbl.img"
bin\Windows\fastboot flash xbl_config_ab "firmware-update/xbl_config.img"
if exist super.img (
  echo ������� super ����Ԫ����...
  bin\Windows\fastboot erase super
  echo ����ˢ�� super.img, �����ĵȴ�...
  bin\Windows\fastboot flash super "super.img"
)
echo ˢ�� super.img ���ܻῨһ���, �����ĵȴ�!
bin\Windows\fastboot set_active a
bin\Windows\fastboot reboot
pause
