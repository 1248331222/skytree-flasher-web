fastboot flash apusys_ab images/apusys.img
sleep 2
fastboot flash audio_dsp_ab images/audio_dsp.img
sleep 2
fastboot flash ccu_ab images/ccu.img
sleep 2
fastboot flash dpm_ab images/dpm.img
sleep 2
fastboot flash dtbo_ab images/dtbo.img
sleep 2
fastboot flash gpueb_ab images/gpueb.img
sleep 2
fastboot flash gz_ab images/gz.img
sleep 2
fastboot flash lk_ab images/lk.img
sleep 3
fastboot flash logo_ab images/logo.img
sleep 2
fastboot flash mcf_ota_ab images/mcf_ota.img
sleep 2
fastboot flash mcupm_ab images/mcupm.img
sleep 2
fastboot flash md1img_ab images/md1img.img
sleep 2
fastboot flash mvpu_algo_ab images/mvpu_algo.img
sleep 2
fastboot flash pi_img_ab images/pi_img.img
sleep 2
fastboot flash preloader1 images/preloader_raw.img
sleep 4
fastboot flash preloader2 images/preloader_raw.img
sleep 4
fastboot flash scp_ab images/scp.img
sleep 2
fastboot flash spmfw_ab images/spmfw.img
sleep 2
fastboot flash sspm_ab images/sspm.img
sleep 2
fastboot flash tee_ab images/tee.img
sleep 2
fastboot flash vbmeta_ab images/vbmeta.img
sleep 2
fastboot flash vbmeta_system_ab images/vbmeta_system.img
sleep 2
fastboot flash vbmeta_vendor_ab images/vbmeta_vendor.img
sleep 2
fastboot flash vcp_ab images/vcp.img
sleep 2
fastboot flash vendor_boot_ab images/vendor_boot.img
sleep 2
fastboot flash boot_ab images/boot.img
sleep 3
fastboot flash super images/super.img
fastboot flash cust images/cust.img
sleep 2
fastboot erase userdata
fastboot erase metadata
fastboot erase cache
fastboot set_active a
fastboot reboot
