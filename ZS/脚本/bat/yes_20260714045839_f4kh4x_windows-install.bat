@echo off
mode con cols=100 lines=30
title Fastboot Flash Script

if %PROCESSOR_ARCHITECTURE%==x86 (set cpuArch=x86) else set cpuArch=amd64


echo.
echo.
echo.Press any key to continue...
pause >nul 2>nul
cls
echo.Do not close this window or touch the mouse and keyboard.
echo.Ready.
echo.

:MAIN
if exist images\apusys.img (
bin\windows\all\fastboot %* flash apusys_ab images\apusys.img
)
if exist images\audio_dsp.img (
bin\windows\all\fastboot %* flash audio_dsp_ab images\audio_dsp.img
)
if exist images\ccu.img (
bin\windows\all\fastboot %* flash ccu_ab images\ccu.img
)
if exist images\dpm.img (
bin\windows\all\fastboot %* flash dpm_ab images\dpm.img
)
if exist images\dtbo.img (
bin\windows\all\fastboot %* flash dtbo_ab images\dtbo.img
)
if exist images\gpueb.img (
bin\windows\all\fastboot %* flash gpueb_ab images\gpueb.img
)
if exist images\gz.img (
bin\windows\all\fastboot %* flash gz_ab images\gz.img
)
if exist images\lk.img (
bin\windows\all\fastboot %* flash lk_ab images\lk.img
)
if exist images\logo.img (
bin\windows\all\fastboot %* flash logo_ab images\logo.img
)
if exist images\mcf_ota.img (
bin\windows\all\fastboot %* flash mcf_ota_ab images\mcf_ota.img
)
if exist images\mcupm.img (
bin\windows\all\fastboot %* flash mcupm_ab images\mcupm.img
)
if exist images\md1img.img (
bin\windows\all\fastboot %* flash md1img_ab images\md1img.img
)
if exist images\mvpu_algo.img (
bin\windows\all\fastboot %* flash mvpu_algo_ab images\mvpu_algo.img
)
if exist images\pi_img.img (
bin\windows\all\fastboot %* flash pi_img_ab images\pi_img.img
)
if exist images\preloader_raw.img (
bin\windows\all\fastboot %* flash preloader1 images\preloader_raw.img
)
if exist images\preloader_raw.img (
bin\windows\all\fastboot %* flash preloader2 images\preloader_raw.img
)
if exist images\scp.img (
bin\windows\all\fastboot %* flash scp_ab images\scp.img
)
if exist images\spmfw.img (
bin\windows\all\fastboot %* flash spmfw_ab images\spmfw.img
)
if exist images\sspm.img (
bin\windows\all\fastboot %* flash sspm_ab images\sspm.img
)
if exist images\tee.img (
bin\windows\all\fastboot %* flash tee_ab images\tee.img
)
if exist images\vbmeta.img (
bin\windows\all\fastboot %* flash vbmeta_ab images\vbmeta.img
)
if exist images\vbmeta_system.img (
bin\windows\all\fastboot %* flash vbmeta_system_ab images\vbmeta_system.img
)
if exist images\vbmeta_vendor.img (
bin\windows\all\fastboot %* flash vbmeta_vendor_ab images\vbmeta_vendor.img
)
if exist images\vcp.img (
bin\windows\all\fastboot %* flash vcp_ab images\vcp.img
)
if exist images\vendor_boot.img (
bin\windows\all\fastboot %* flash vendor_boot_ab images\vendor_boot.img
)
@REM flash firmware done

bin\windows\all\fastboot %* flash boot_ab images\boot.img

if exist images\super.img (
echo.
echo.Flashing super.img, this may take a long time...
echo.Do not close this window or touch the mouse and keyboard.
bin\windows\all\fastboot %* flash super images\super.img
)

bin\windows\all\fastboot %* flash cust images\cust.img

bin\windows\all\fastboot %* erase userdata
bin\windows\all\fastboot %* erase metadata

bin\windows\all\fastboot %* set_active a
bin\windows\all\fastboot %* reboot

echo.
echo.
echo.Flash complete.
echo.Press any key to exit.
pause >nul
exit