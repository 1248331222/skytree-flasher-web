fastboot %* getvar product 2>&1 | findstr /r /c:"^product: *polaris" || echo Missmatching image and device
fastboot %* getvar product 2>&1 | findstr /r /c:"^product: *polaris" || exit /B 1
::set CURRENT_ANTI_VER=1
::for /f "tokens=2 delims=: " %%i in ('fastboot %* getvar anti 2^>^&1 ^| findstr /r /c:"anti:"') do (set version=%%i)
::if [%version%] EQU [] set version=0
::if %version% GTR %CURRENT_ANTI_VER% (
::    echo current device antirollback version is greater than this pakcage
::    exit /B 1
::)
fastboot %* erase boot || @echo "Erase boot error" && exit /B 1
fastboot %* flash xbl_ab %~dp0images\xbl.img || @echo "Flash xbl_ab error" && exit /B 1
fastboot %* flash xbl_config_ab %~dp0images\xbl_config.img || @echo "Flash xbl_config_ab error" && exit /B 1
fastboot %* flash abl_ab %~dp0images\abl.img || @echo "Flash abl_ab error" && exit /B 1
fastboot %* flash tz_ab %~dp0images\tz.img || @echo "Flash tz_ab error" && exit /B 1
fastboot %* flash hyp_ab %~dp0images\hyp.img || @echo "Flash hyp_ab error" && exit /B 1
fastboot %* flash devcfg_ab %~dp0images\devcfg.img || @echo "Flash devcfg_ab error" && exit /B 1
fastboot %* flash storsec_ab %~dp0images\storsec.img || @echo "Flash storsec_ab error" && exit /B 1
fastboot %* flash bluetooth %~dp0images\bluetooth.img || @echo "Flash bluetooth error" && exit /B 1
fastboot %* flash cmnlib_ab %~dp0images\cmnlib.img || @echo "Flash cmnlib_ab error" && exit /B 1
fastboot %* flash cmnlib64_ab %~dp0images\cmnlib64.img || @echo "Flash cmnlib64_ab error" && exit /B 1
fastboot %* flash modem %~dp0images\modem.img || @echo "Flash modem error" && exit /B 1
fastboot %* flash dsp %~dp0images\dsp.img || @echo "Flash dsp error" && exit /B 1
fastboot %* flash keymaster_ab %~dp0images\keymaster.img || @echo "Flash keymaster_ab error" && exit /B 1
fastboot %* flash logo %~dp0images\logo.img || @echo "Flash logo_ab error" && exit /B 1
fastboot %* flash misc %~dp0images\misc.img || @echo "Flash misc error" && exit /B 1
fastboot %* flash aop_ab %~dp0images\aop.img || @echo "Flash aop_ab error" && exit /B 1
fastboot %* flash qupfw_ab %~dp0images\qupfw.img || @echo "Flash qupfw_ab error" && exit /B 1
fastboot %* flash ImageFv %~dp0images\imagefv.elf || @echo "Flash imagefv error" && exit /B 1
fastboot %* flash vendor %~dp0images\vendor.img || @echo "Flash vendor_ab error" && exit /B 1
fastboot %* flash system %~dp0images\system.img || @echo "Flash system_ab error" && exit /B 1
fastboot %* flash recovery %~dp0images\recovery.img || @echo "Flash recovery error" && exit /B 1
fastboot %* flash mi_ext %~dp0images\mi_ext.img || @echo "Flash mi_ext error" && exit /B 1
fastboot %* erase sec || @echo "Erase sec error" && exit /B 1
fastboot %* flash boot %~dp0images\boot.img || @echo "Flash boot error" && exit /B 1
fastboot %* -w || @echo "Format userdata error" && exit /B 1
fastboot %* reboot || @echo "Reboot error" && exit /B 1
