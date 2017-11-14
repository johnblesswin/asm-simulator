import { Injectable } from '@angular/core';

import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';

import { OpCode, OperandType, Instruction, instructionSet } from './instrset';
import { MemoryService } from './memory.service';

import {
    CPURegisterIndex, CPURegister, CPUStatusRegister, CPURegisterOperation,
    CPUGeneralPurposeRegister, CPUStackPointerRegister
} from './cpuregs';


const IRQ_VECTOR_ADDRESS = 0x0003;
const SYSCALL_VECTOR_ADDRESS = 0x0006;


@Injectable()
export class CPUService {

    protected registersBank: Map<CPURegisterIndex, CPURegister> = new Map<CPURegisterIndex, CPURegister>();

    protected cpuRegisterOperationSource = new Subject<CPURegisterOperation>();

    public cpuRegisterOperation$: Observable<CPURegisterOperation>;

    protected nextIP = 0;

    private interruptInput = 0;

    protected static is16bitsGPR(index: CPURegisterIndex): boolean {

        return (index === CPURegisterIndex.A ||
            index === CPURegisterIndex.B ||
            index === CPURegisterIndex.C ||
            index === CPURegisterIndex.D);

    }

    protected static is16bitsGPRorSP(index: CPURegisterIndex): boolean {

        return (CPUService.is16bitsGPR(index) || index === CPURegisterIndex.SP);

    }

    protected static is8bitsGPR(index: CPURegisterIndex): boolean {

        return (index === CPURegisterIndex.AH ||
            index === CPURegisterIndex.AL ||
            index === CPURegisterIndex.BH ||
            index === CPURegisterIndex.BL ||
            index === CPURegisterIndex.CH ||
            index === CPURegisterIndex.CL ||
            index === CPURegisterIndex.DH ||
            index === CPURegisterIndex.DL);

    }

    protected static getByteFrom8bitsGPR(index: CPURegisterIndex): string {

        let byte: string;

        switch (index) {
            case CPURegisterIndex.AH:
            case CPURegisterIndex.BH:
            case CPURegisterIndex.CH:
            case CPURegisterIndex.DH:
                byte = 'msb';
                break;
            case CPURegisterIndex.AL:
            case CPURegisterIndex.BL:
            case CPURegisterIndex.CL:
            case CPURegisterIndex.DL:
                byte = 'lsb';
                break;
        }
        return byte;

    }


    protected static divideBy(dividend: number, divisor: number) {

        if (divisor === 0) {
            throw Error('Division by 0');
        }

        return Math.floor(dividend / divisor);
    }

    constructor(protected memoryService: MemoryService) {

        const registerA = new CPUGeneralPurposeRegister('A', CPURegisterIndex.A, 0,
            this.cpuRegisterOperationSource, 'General Purpose Register A');
        this.registersBank.set(CPURegisterIndex.A, registerA);
        this.registersBank.set(CPURegisterIndex.AH, registerA);
        this.registersBank.set(CPURegisterIndex.AL, registerA);

        const registerB = new CPUGeneralPurposeRegister('B', CPURegisterIndex.B, 0,
            this.cpuRegisterOperationSource, 'General Purpose Register B')
        this.registersBank.set(CPURegisterIndex.B, registerB);
        this.registersBank.set(CPURegisterIndex.BH, registerB);
        this.registersBank.set(CPURegisterIndex.BL, registerB);

        const registerC = new CPUGeneralPurposeRegister('C', CPURegisterIndex.C, 0,
            this.cpuRegisterOperationSource, 'General Purpose Register C');
        this.registersBank.set(CPURegisterIndex.C, registerC);
        this.registersBank.set(CPURegisterIndex.CH, registerC);
        this.registersBank.set(CPURegisterIndex.CL, registerC);

        const registerD = new CPUGeneralPurposeRegister('D', CPURegisterIndex.D, 0,
            this.cpuRegisterOperationSource, 'General Purpose Register D');
        this.registersBank.set(CPURegisterIndex.D, registerD);
        this.registersBank.set(CPURegisterIndex.DH, registerD);
        this.registersBank.set(CPURegisterIndex.DL, registerD);

        this.registersBank.set(CPURegisterIndex.SP,
            new CPUStackPointerRegister('SP', CPURegisterIndex.SP, 0,
                this.cpuRegisterOperationSource, 'Stack Pointer Register'));
        this.registersBank.set(CPURegisterIndex.IP,
            new CPURegister('IP', CPURegisterIndex.IP, 0,
                this.cpuRegisterOperationSource, 'Instruction Pointer Register'));

        this.registersBank.set(CPURegisterIndex.SR,
            new CPUStatusRegister('SR', CPURegisterIndex.SR, 0x8000,
                this.cpuRegisterOperationSource, 'Status Register'));

        this.cpuRegisterOperation$ = this.cpuRegisterOperationSource.asObservable();

    }

    public getRegistersBank(): Map<CPURegisterIndex, CPURegister> {

        return this.registersBank;

    }

    protected get SP(): CPUStackPointerRegister {
        return <CPUStackPointerRegister>this.registersBank.get(CPURegisterIndex.SP);
    }

    protected get IP(): CPURegister {
        return this.registersBank.get(CPURegisterIndex.IP);
    }

    protected get SR(): CPUStatusRegister {
        return <CPUStatusRegister>this.registersBank.get(CPURegisterIndex.SR);
    }

    protected check8bitOperation(value: number): number {

        this.SR.carry = 0;
        this.SR.zero = 0;

        if (value >= 256) {
            this.SR.carry = 1;
            value = value % 256;
        } else if (value === 0) {
            this.SR.zero = 1;
        } else if (value < 0) {
            this.SR.carry = 1;
            value = 256 - (-value) % 256;
        }

        return value;

    }

    protected check16bitOperation(value: number): number {

        this.SR.carry = 0;
        this.SR.zero = 0;

        if (value >= 65536) {
            this.SR.carry = 1;
            value = value % 65536;
        } else if (value === 0) {
            this.SR.zero = 1;
        } else if (value < 0) {
            this.SR.carry = 1;
            value = 65536 - (-value) % 65536;
        }

        return value;

    }

    protected pushByte(value: number) {

        const currentSP = this.SP.value;
        this.memoryService.storeByte(currentSP, value);
        this.SP.pushByte();

    }

    protected pushWord(value: number) {

        const currentSP = this.SP.value;
        this.memoryService.storeWord(currentSP - 1, value);
        this.SP.pushWord();

    }

    protected popByte(): number {

        const currentSP = this.SP.value;
        const value = this.memoryService.loadByte(currentSP + 1);
        this.SP.popByte();

        return value;

    }

    protected popWord(): number {

        const currentSP = this.SP.value;
        const value = this.memoryService.loadWord(currentSP + 1);
        this.SP.popWord();

        return value;

    }

    private toInterruptHandler() {

        this.pushWord(this.SR.value);
        this.pushWord(this.IP.value);

        this.IP.value = IRQ_VECTOR_ADDRESS;

        this.SR.irqMask = 1;
        this.SR.supervisor = 1;

    }

    public raiseInterrupt() {

        if (this.SR.fault === 1) {

            throw Error('CPU in FAULT mode: reset required');

        }

        this.interruptInput = 1;

        if (this.SR.irqMask === 0) {

            this.toInterruptHandler();

        }

    }

    public lowerInterrupt() {

        this.interruptInput = 0;

    }

    public step() {

        if (this.SR.halt === 1) {

            return;

        } else if (this.SR.fault === 1) {

            throw Error('CPU in FAULT mode: reset required');

        }

        this.nextIP = this.IP.value;

        const opcode = this.memoryService.loadByte(this.nextIP);
        this.nextIP += 1;

        const instruction = instructionSet.getInstructionFromOpCode(opcode);

        if (instruction === undefined) {
            this.SR.fault = 1;
            throw Error(`Invalid opcode: ${opcode}`);
        }

        const args: Array<number> = [];

        switch (instruction.operand1) {

            case OperandType.BYTE:
                const byte = this.memoryService.loadByte(this.nextIP);
                args.push(byte);
                this.nextIP += 1;
                break;
            case OperandType.REGISTER_8BITS:
            case OperandType.REGISTER_16BITS:
                let register = this.memoryService.loadByte(this.nextIP);
                args.push(register);
                this.nextIP += 1;
                break;
            case OperandType.WORD:
            case OperandType.ADDRESS:
                const word = this.memoryService.loadWord(this.nextIP);
                args.push(word);
                this.nextIP += 2;
                break;
            case OperandType.REGADDRESS:
                const regaddress = this.memoryService.loadWord(this.nextIP);
                let offset = (regaddress & 0xFF00) >>> 8;
                register = (regaddress & 0x00FF);
                if ( offset > 127 ) {
                    offset = offset - 256;
                }
                args.push(register);
                args.push(offset);
                this.nextIP += 2;
                break;
            default:
                break;
        }

        switch (instruction.operand2) {

            case OperandType.BYTE:
                const byte = this.memoryService.loadByte(this.nextIP);
                args.push(byte);
                this.nextIP += 1;
                break;
            case OperandType.REGISTER_8BITS:
            case OperandType.REGISTER_16BITS:
                let register = this.memoryService.loadByte(this.nextIP);
                args.push(register);
                this.nextIP += 1;
                break;
            case OperandType.WORD:
            case OperandType.ADDRESS:
                const word = this.memoryService.loadWord(this.nextIP);
                args.push(word);
                this.nextIP += 2;
                break;
            case OperandType.REGADDRESS:
                const regaddress = this.memoryService.loadWord(this.nextIP);
                let offset = (regaddress & 0xFF00) >>> 8;
                register = (regaddress & 0x00FF);
                if ( offset > 127 ) {
                    offset = offset - 256;
                }
                args.push(register);
                args.push(offset);
                this.nextIP += 2;
                break;
        }

        if (this[instruction.methodName].apply(this, args) === true) {
            this.IP.value = this.nextIP;
        }

    }

    @Instruction(OpCode.HLT, 'HLT')
    private instrHLT(): boolean {

        this.SR.halt = 1;

        return false;

    }

    @Instruction(OpCode.MOV_REG16_TO_REG16, 'MOV', OperandType.REGISTER_16BITS, OperandType.REGISTER_16BITS)
    private instrMOV_REG16_TO_REG16(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value = this.registersBank.get(fromRegister).value;

        return true;

    }

    @Instruction(OpCode.MOV_ADDRESS_TO_REG16, 'MOV', OperandType.REGISTER_16BITS, OperandType.ADDRESS)
    private instrMOV_ADDRESS_TO_REG16(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value = this.memoryService.loadWord(fromAddress);

        return true;

    }

    @Instruction(OpCode.MOV_REGADDRESS_TO_REG16, 'MOV', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrMOV_REGADDRESS_TO_REG16(toRegister: number, fromRegister: number, fromOffset): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;

        this.registersBank.get(toRegister).value = this.memoryService.loadWord(address);

        return true;

    }

    @Instruction(OpCode.MOV_REG16_TO_ADDRESS, 'MOV', OperandType.ADDRESS, OperandType.REGISTER_16BITS)
    private instrMOV_REG16_TO_ADDRESS(toAddress: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.memoryService.storeWord(toAddress, this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.MOV_REG16_TO_REGADDRESS, 'MOV', OperandType.REGADDRESS, OperandType.REGISTER_16BITS)
    private instrMOV_REG16_TO_REGADDRESS(toRegister: number, toOffset: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;

        this.memoryService.storeWord(address, this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.MOV_WORD_TO_REG16, 'MOV', OperandType.REGISTER_16BITS, OperandType.WORD)
    private instrMOV_WORD_TO_REG16(toRegister: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value = word;

        return true;
    }

    @Instruction(OpCode.MOV_WORD_TO_ADDRESS, 'MOV', OperandType.ADDRESS, OperandType.WORD)
    private instrMOV_WORD_TO_ADDRESS(toAddress: number, word: number): boolean {

        this.memoryService.storeWord(toAddress, word);

        return true;

    }

    @Instruction(OpCode.MOV_WORD_TO_REGADDRESS, 'MOV', OperandType.REGADDRESS, OperandType.WORD)
    private instrMOV_WORD_TO_REGADDRESS(toRegister: number, toOffset: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;

        this.memoryService.storeWord(address, word);

        return true;

    }

    @Instruction(OpCode.MOVB_REG8_TO_REG8, 'MOVB', OperandType.REGISTER_8BITS, OperandType.REGISTER_8BITS)
    private instrMOVB_REG8_TO_REG8(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);
        this.registersBank.get(toRegister)[byteToRegister] = this.registersBank.get(fromRegister)[byteFromRegister];

        return true;

    }

    @Instruction(OpCode.MOVB_ADDRESS_TO_REG8, 'MOVB', OperandType.REGISTER_8BITS, OperandType.ADDRESS)
    private instrMOVB_ADDRESS_TO_REG8(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] = this.memoryService.loadByte(fromAddress);

        return true;

    }

    @Instruction(OpCode.MOVB_REGADDRESS_TO_REG8, 'MOVB', OperandType.REGISTER_8BITS, OperandType.REGADDRESS)
    private instrMOVB_REGADDRESS_TO_REG8(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;
        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] = this.memoryService.loadByte(address);

        return true;

    }

    @Instruction(OpCode.MOVB_REG8_TO_ADDRESS, 'MOVB', OperandType.ADDRESS, OperandType.REGISTER_8BITS)
    private instrMOVB_REG8_TO_ADDRESS(toAddress: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.memoryService.storeByte(toAddress, this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;


    }

    @Instruction(OpCode.MOVB_REG8_TO_REGADDRESS, 'MOVB', OperandType.REGADDRESS, OperandType.REGISTER_8BITS)
    private instrMOVB_REG8_TO_REGADDRESS(toRegister: number, toOffset: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.memoryService.storeByte(address, this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;

    }

    @Instruction(OpCode.MOVB_BYTE_TO_REG8, 'MOVB', OperandType.REGISTER_8BITS, OperandType.BYTE)
    private instrMOVB_BYTE_TO_REG8(toRegister: number, byte: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] = byte;

        return true;

    }

    @Instruction(OpCode.MOVB_BYTE_TO_ADDRESS, 'MOVB', OperandType.ADDRESS, OperandType.BYTE)
    private instrMOVB_BYTE_TO_ADDRESS(toAddress: number, byte: number): boolean {

        this.memoryService.storeByte(toAddress, byte);

        return true;

    }

    @Instruction(OpCode.MOVB_BYTE_TO_REGADDRESS, 'MOVB', OperandType.REGADDRESS, OperandType.BYTE)
    private instrMOVB_BYTE_TO_REGADDRESS(toRegister: number, toOffset: number, byte: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;

        this.memoryService.storeByte(address, byte);

        return true;

    }

    @Instruction(OpCode.ADD_REG16_TO_REG16, 'ADD', OperandType.REGISTER_16BITS, OperandType.REGISTER_16BITS)
    private instrADD_REG16_TO_REG16(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value +
                                     this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.ADD_REGADDRESS_TO_REG16, 'ADD', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrADD_REGADDRESS_TO_REG16(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value +
                                     this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.ADD_ADDRESS_TO_REG16, 'ADD', OperandType.REGISTER_16BITS, OperandType.ADDRESS)
    private instrADD_ADDRESS_TO_REG16(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value +
                                     this.memoryService.loadWord(fromAddress));

        return true;

    }

    @Instruction(OpCode.ADD_WORD_TO_REG16, 'ADD', OperandType.REGISTER_16BITS, OperandType.WORD)
    private instrADD_WORD_TO_REG16(toRegister: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value + word);

        return true;

    }

    @Instruction(OpCode.ADDB_REG8_TO_REG8, 'ADDB', OperandType.REGISTER_8BITS, OperandType.REGISTER_8BITS)
    private instrADDB_REG8_TO_REG8(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] +
                this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;

    }

    @Instruction(OpCode.ADDB_REGADDRESS_TO_REG8, 'ADDB', OperandType.REGISTER_8BITS, OperandType.REGADDRESS)
    private instrADDB_REGADDRESS_TO_REG8(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;
        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] +
                                    this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.ADDB_ADDRESS_TO_REG8, 'ADDB', OperandType.REGISTER_8BITS, OperandType.ADDRESS)
    private instrADDB_ADDRESS_TO_REG8(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] +
                                this.memoryService.loadByte(fromAddress));

        return true;

    }

    @Instruction(OpCode.ADDB_BYTE_TO_REG8, 'ADDB', OperandType.REGISTER_8BITS, OperandType.BYTE)
    private instrADDB_BYTE_TO_REG(toRegister: number, byte: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] + byte);

        return true;

    }

    @Instruction(OpCode.SUB_REG16_FROM_REG16, 'SUB', OperandType.REGISTER_16BITS, OperandType.REGISTER_16BITS)
    private instrSUB_REG16_FROM_REG16(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value -
                                     this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.SUB_REGADDRESS_FROM_REG16, 'SUB', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrSUB_REGADDRESS_FROM_REG16(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value -
                                     this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.SUB_ADDRESS_FROM_REG16, 'SUB', OperandType.REGISTER_16BITS, OperandType.ADDRESS)
    private instrSUB_ADDRESS_FROM_REG16(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value -
                                     this.memoryService.loadWord(fromAddress));

        return true;

    }

    @Instruction(OpCode.SUB_WORD_FROM_REG16, 'SUB', OperandType.REGISTER_16BITS, OperandType.WORD)
    private instrSUB_WORD_FROM_REG16(toRegister: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value - word);

        return true;

    }

    @Instruction(OpCode.SUBB_REG8_FROM_REG8, 'SUBB', OperandType.REGISTER_8BITS, OperandType.REGISTER_8BITS)
    private instrSUBB_REG8_FROM_REG8(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] -
                this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;

    }

    @Instruction(OpCode.SUBB_REGADDRESS_FROM_REG8, 'SUBB', OperandType.REGISTER_8BITS, OperandType.REGADDRESS)
    private instrSUBB_REGADDRESS_FROM_REG8(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;
        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] -
                                    this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.SUBB_ADDRESS_FROM_REG8, 'SUBB', OperandType.REGISTER_8BITS, OperandType.ADDRESS)
    private instrSUBB_ADDRESS_FROM_REG8(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] -
                this.memoryService.loadByte(fromAddress));

        return true;

    }

    @Instruction(OpCode.SUBB_BYTE_FROM_REG8, 'SUBB', OperandType.REGISTER_8BITS, OperandType.BYTE)
    private instrSUBB_BYTE_FROM_REG8(toRegister: number, byte: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] - byte);

        return true;

    }

    @Instruction(OpCode.INC_REG16, 'INC', OperandType.REGISTER_16BITS)
    private instrINC_REG16(toRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value + 1);

        return true;

    }

    @Instruction(OpCode.INCB_REG8, 'INCB', OperandType.REGISTER_8BITS)
    private instrINCB_REG8(toRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] + 1);

        return true;

    }

    @Instruction(OpCode.DEC_REG16, 'DEC', OperandType.REGISTER_16BITS)
    private instrDEC_REG16(toRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value - 1);

        return true;

    }

    @Instruction(OpCode.DECB_REG8, 'DECB', OperandType.REGISTER_8BITS)
    private instrDECB_REG8(toRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] - 1);

        return true;

    }

    @Instruction(OpCode.CMP_REG16_WITH_REG16, 'CMP', OperandType.REGISTER_16BITS, OperandType.REGISTER_16BITS)
    private instrCMP_REG16_WITH_REG16(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.check16bitOperation(this.registersBank.get(toRegister).value -
            this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.CMP_REGADDRESS_WITH_REG16, 'CMP', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrCMP_REGADDRESS_WITH_REG16(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;

        this.check16bitOperation(this.registersBank.get(toRegister).value -
            this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.CMP_ADDRESS_WITH_REG16, 'CMP', OperandType.REGISTER_16BITS, OperandType.ADDRESS)
    private instrCMP_ADDRESS_WITH_REG16(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.check16bitOperation(this.registersBank.get(toRegister).value -
            this.memoryService.loadWord(fromAddress));

        return true;

    }

    @Instruction(OpCode.CMP_WORD_WITH_REG16, 'CMP', OperandType.REGISTER_16BITS, OperandType.WORD)
    private instrCMP_WORD_WITH_REG16(toRegister: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.check16bitOperation(this.registersBank.get(toRegister).value - word);

        return true;

    }

    @Instruction(OpCode.CMPB_REG8_WITH_REG8, 'CMPB', OperandType.REGISTER_8BITS, OperandType.REGISTER_8BITS)
    private instrCMPB_REG8_WITH_REG8(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] -
            this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;

    }

    @Instruction(OpCode.CMPB_REGADDRESS_WITH_REG8, 'CMPB', OperandType.REGISTER_8BITS, OperandType.REGADDRESS)
    private instrCMPB_REGADDRESS_WITH_REG8(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;
        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] -
            this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.CMPB_ADDRESS_WITH_REG8, 'CMPB', OperandType.REGISTER_8BITS, OperandType.ADDRESS)
    private instrCMPB_ADDRESS_WITH_REG8(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] -
            this.memoryService.loadByte(fromAddress));

        return true;

    }

    @Instruction(OpCode.CMPB_BYTE_WITH_REG8, 'CMPB', OperandType.REGISTER_8BITS, OperandType.BYTE)
    private instrCMPB_BYTE_WITH_REG8(toRegister: number, byte: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] - byte);

        return true;

    }

    @Instruction(OpCode.JMP_REGADDRESS, 'JMP', OperandType.REGADDRESS)
    private instrJMP_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.IP.value = this.registersBank.get(toRegister).value + toOffset;

        return false;

    }

    @Instruction(OpCode.JMP_ADDRESS, 'JMP', OperandType.WORD)
    private instrJMP_ADDRESS(toAddress: number): boolean {

        this.IP.value = toAddress;

        return false;

    }

    @Instruction(OpCode.JC_REGADDRESS, 'JC', OperandType.REGADDRESS)
    private instrJC_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        if (this.SR.carry === 1) {
            this.IP.value = this.registersBank.get(toRegister).value + toOffset;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JC_ADDRESS, 'JC', OperandType.WORD)
    private instrJC_ADDRESS(toAddress: number): boolean {

        if (this.SR.carry === 1) {
            this.IP.value = toAddress;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JNC_REGADDRESS, 'JNC', OperandType.REGADDRESS)
    private instrJNC_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        if (this.SR.carry === 0) {
            this.IP.value = this.registersBank.get(toRegister).value + toOffset;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JNC_ADDRESS, 'JNC', OperandType.WORD)
    private instrJNC_ADDRESS(toAddress: number): boolean {

        if (this.SR.carry === 0) {
            this.IP.value = toAddress;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JZ_REGADDRESS, 'JZ', OperandType.REGADDRESS)
    private instrJZ_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        if (this.SR.zero === 1) {
            this.IP.value = this.registersBank.get(toRegister).value + toOffset;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JZ_ADDRESS, 'JZ', OperandType.WORD)
    private instrJZ_ADDRESS(toAddress: number): boolean {

        if (this.SR.zero === 1) {
            this.IP.value = toAddress;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JNZ_REGADDRESS, 'JNZ', OperandType.REGADDRESS)
    private instrJNZ_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        if (this.SR.zero === 0) {
            this.IP.value = this.registersBank.get(toRegister).value + toOffset;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JNZ_ADDRESS, 'JNZ', OperandType.WORD)
    private instrJNZ_ADDRESS(toAddress: number): boolean {

        if (this.SR.zero === 0) {
            this.IP.value = toAddress;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JA_REGADDRESS, 'JA', OperandType.REGADDRESS)
    private instrJA_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        if ((this.SR.carry === 0) && (this.SR.zero === 0)) {
            this.IP.value = this.registersBank.get(toRegister).value + toOffset;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JA_ADDRESS, 'JA', OperandType.WORD)
    private instrJA_ADDRESS(toAddress: number): boolean {

        if ((this.SR.carry === 0) && (this.SR.zero === 0)) {
            this.IP.value = toAddress;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JNA_REGADDRESS, 'JNA', OperandType.REGADDRESS)
    private instrJNA_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        if ((this.SR.carry === 1) || (this.SR.zero === 1)) {
            this.IP.value = this.registersBank.get(toRegister).value + toOffset;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.JNA_ADDRESS, 'JNA', OperandType.WORD)
    private instrJNA_ADDRESS(toAddress: number): boolean {

        if ((this.SR.carry === 1) || (this.SR.zero === 1)) {
            this.IP.value = toAddress;
            return false;
        } else {
            return true;
        }

    }

    @Instruction(OpCode.PUSH_REG16, 'PUSH', OperandType.REGISTER_16BITS)
    private instrPUSH_REG16(toRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.pushWord(this.registersBank.get(toRegister).value);

        return true;

    }

    @Instruction(OpCode.PUSH_REGADDRESS, 'PUSH', OperandType.REGADDRESS)
    private instrPUSH_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;

        this.pushWord(this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.PUSH_ADDRESS, 'PUSH', OperandType.ADDRESS)
    private instrPUSH_ADDRESS(toAddress: number): boolean {

        this.pushWord(this.memoryService.loadWord(toAddress));

        return true;

    }

    @Instruction(OpCode.PUSH_WORD, 'PUSH', OperandType.WORD)
    private instrPUSH_WORD(word: number): boolean {

        this.pushWord(word);

        return true;

    }

    @Instruction(OpCode.PUSHB_REG8, 'PUSHB', OperandType.REGISTER_8BITS)
    private instrPUSHB_REG8(toRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.pushByte(this.registersBank.get(toRegister)[byteToRegister]);

        return true;

    }

    @Instruction(OpCode.PUSHB_REGADDRESS, 'PUSHB', OperandType.REGADDRESS)
    private instrPUSHB_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;

        this.pushByte(this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.PUSHB_ADDRESS, 'PUSHB', OperandType.ADDRESS)
    private instrPUSHB_ADDRESS(toAddress: number): boolean {

        this.pushByte(this.memoryService.loadByte(toAddress));

        return true;

    }

    @Instruction(OpCode.PUSHB_BYTE, 'PUSHB', OperandType.BYTE)
    private instrPUSHB_BYTE(byte: number): boolean {

        this.pushByte(byte);

        return true;

    }

    @Instruction(OpCode.POP_REG16, 'POP', OperandType.REGISTER_16BITS)
    private instrPOP_REG16(toRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value = this.popWord();

        return true;

    }

    @Instruction(OpCode.POPB_REG8, 'POPB', OperandType.REGISTER_8BITS)
    private instrPOPB_REG8(toRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] = this.popByte();

        return true;

    }

    @Instruction(OpCode.CALL_REGADDRESS, 'CALL', OperandType.REGADDRESS)
    private instrCALL_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.pushWord(this.nextIP);

        this.IP.value = this.registersBank.get(toRegister).value + toOffset;

        return false;

    }

    @Instruction(OpCode.CALL_ADDRESS, 'CALL', OperandType.WORD)
    private instrCALL_ADDRESS(toAddress: number): boolean {

        this.pushWord(this.nextIP);

        this.IP.value = toAddress;

        return false;

    }

    @Instruction(OpCode.RET, 'RET')
    private instrRET(): boolean {

        this.IP.value = this.popWord();

        return false;

    }

    @Instruction(OpCode.MUL_REG16, 'MUL', OperandType.REGISTER_16BITS)
    private instrMUL_REG(toRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(CPURegisterIndex.A).value =
            this.check16bitOperation(this.registersBank.get(CPURegisterIndex.A).value *
                                     this.registersBank.get(toRegister).value);

        return true;

    }

    @Instruction(OpCode.MUL_REGADDRESS, 'MUL', OperandType.REGADDRESS)
    private instrMUL_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;

        this.registersBank.get(CPURegisterIndex.A).value =
            this.check16bitOperation(this.registersBank.get(CPURegisterIndex.A).value *
                                     this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.MUL_ADDRESS, 'MUL', OperandType.ADDRESS)
    private instrMUL_ADDRESS(toAddress: number): boolean {

        this.registersBank.get(CPURegisterIndex.A).value =
            this.check16bitOperation(this.registersBank.get(CPURegisterIndex.A).value *
                this.memoryService.loadWord(toAddress));

        return true;

    }

    @Instruction(OpCode.MUL_WORD, 'MUL', OperandType.WORD)
    private instrMUL_WORD(word: number): boolean {


        this.registersBank.get(CPURegisterIndex.A).value =
            this.check16bitOperation(this.registersBank.get(CPURegisterIndex.A).value *
                word);

        return true;

    }

    @Instruction(OpCode.MULB_REG8, 'MULB', OperandType.REGISTER_8BITS)
    private instrMULB_REG8(toRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(CPURegisterIndex.A)['lsb'] =
            this.check8bitOperation(this.registersBank.get(CPURegisterIndex.A)['lsb'] *
                this.registersBank.get(toRegister)[byteToRegister]);

        return true;

    }

    @Instruction(OpCode.MULB_REGADDRESS, 'MULB', OperandType.REGADDRESS)
    private instrMULB_REGADDRESS(toRegister: number, toOffset: number): boolean {


        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;

        this.registersBank.get(CPURegisterIndex.A)['lsb'] =
            this.check8bitOperation(this.registersBank.get(CPURegisterIndex.A)['lsb'] *
                this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.MULB_ADDRESS, 'MULB', OperandType.ADDRESS)
    private instrMULB_ADDRESS(toAddress: number): boolean {

        this.registersBank.get(CPURegisterIndex.A)['lsb'] =
            this.check8bitOperation(this.registersBank.get(CPURegisterIndex.A)['lsb'] *
                this.memoryService.loadByte(toAddress));

        return true;

    }

    @Instruction(OpCode.MULB_BYTE, 'MULB', OperandType.BYTE)
    private instrMULB_WORD(byte: number): boolean {

        this.registersBank.get(CPURegisterIndex.A)['lsb'] =
            this.check8bitOperation(this.registersBank.get(CPURegisterIndex.A)['lsb'] *
                byte);

        return true;

    }

    @Instruction(OpCode.DIV_REG16, 'DIV', OperandType.REGISTER_16BITS)
    private instrDIV_REG16(toRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(CPURegisterIndex.A).value =
            this.check16bitOperation(CPUService.divideBy(this.registersBank.get(CPURegisterIndex.A).value,
                this.registersBank.get(toRegister).value));

        return true;

    }

    @Instruction(OpCode.DIV_REGADDRESS, 'DIV', OperandType.REGADDRESS)
    private instrDIV_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;

        this.registersBank.get(CPURegisterIndex.A).value =
            this.check16bitOperation(CPUService.divideBy(this.registersBank.get(CPURegisterIndex.A).value,
                this.memoryService.loadWord(address)));

        return true;

    }

    @Instruction(OpCode.DIV_ADDRESS, 'DIV', OperandType.ADDRESS)
    private instrDIV_ADDRESS(toAddress: number): boolean {

        this.registersBank.get(CPURegisterIndex.A).value =
            this.check16bitOperation(CPUService.divideBy(this.registersBank.get(CPURegisterIndex.A).value,
                this.memoryService.loadWord(toAddress)));

        return true;

    }

    @Instruction(OpCode.DIV_WORD, 'DIV', OperandType.WORD)
    private instrDIV_WORD(word: number): boolean {

        this.registersBank.get(CPURegisterIndex.A).value =
            this.check16bitOperation(CPUService.divideBy(this.registersBank.get(CPURegisterIndex.A).value, word));

        return true;

    }

    @Instruction(OpCode.DIVB_REG8, 'DIVB', OperandType.REGISTER_8BITS)
    private instrDIVB_REG8(toRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(CPURegisterIndex.A)['lsb'] =
            this.check8bitOperation(CPUService.divideBy(this.registersBank.get(CPURegisterIndex.A)['lsb'],
                this.registersBank.get(toRegister)[byteToRegister]));

        return true;

    }

    @Instruction(OpCode.DIVB_REGADDRESS, 'DIVB', OperandType.REGADDRESS)
    private instrDIVB_REGADDRESS(toRegister: number, toOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const address = this.registersBank.get(toRegister).value + toOffset;

        this.registersBank.get(CPURegisterIndex.A)['lsb'] =
            this.check8bitOperation(CPUService.divideBy(this.registersBank.get(CPURegisterIndex.A)['lsb'],
                this.memoryService.loadByte(address)));

        return true;

    }

    @Instruction(OpCode.DIVB_ADDRESS, 'DIVB', OperandType.ADDRESS)
    private instrDIVB_ADDRESS(toAddress: number): boolean {

        this.registersBank.get(CPURegisterIndex.A)['lsb'] =
            this.check8bitOperation(CPUService.divideBy(this.registersBank.get(CPURegisterIndex.A)['lsb'],
                this.memoryService.loadByte(toAddress)));

        return true;

    }

    @Instruction(OpCode.DIVB_BYTE, 'DIVB', OperandType.BYTE)
    private instrDIV_BYTE(byte: number): boolean {

        this.registersBank.get(CPURegisterIndex.A)['lsb'] =
            this.check8bitOperation(CPUService.divideBy(this.registersBank.get(CPURegisterIndex.A)['lsb'], byte));

        return true;

    }

    @Instruction(OpCode.AND_REG16_WITH_REG16, 'AND', OperandType.REGISTER_16BITS, OperandType.REGISTER_16BITS)
    private instrAND_REG16_WITH_REG16(toRegister: number, fromRegister: number): boolean {


        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value &
                this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.AND_REGADDRESS_WITH_REG16, 'AND', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrAND_REGADDRESS_WITH_REG16(toRegister: number, fromRegister: number, fromOffset: number): boolean {


        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value &
                this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.AND_ADDRESS_WITH_REG16, 'AND', OperandType.REGISTER_16BITS, OperandType.ADDRESS)
    private instrAND_ADDRESS_WITH_REG16(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value &
                this.memoryService.loadWord(fromAddress));

        return true;

    }

    @Instruction(OpCode.AND_WORD_WITH_REG16, 'AND', OperandType.REGISTER_16BITS, OperandType.WORD)
    private instrAND_WORD_WITH_REG(toRegister: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value & word);

        return true;

    }

    @Instruction(OpCode.ANDB_REG8_WITH_REG8, 'ANDB', OperandType.REGISTER_8BITS, OperandType.REGISTER_8BITS)
    private instrANDB_REG8_WITH_REG8(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] &
                this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;

    }

    @Instruction(OpCode.ANDB_REGADDRESS_WITH_REG8, 'ANDB', OperandType.REGISTER_8BITS, OperandType.REGADDRESS)
    private instrANDB_REGADDRESS_WITH_REG8(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;
        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] &
                this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.ANDB_ADDRESS_WITH_REG8, 'ANDB', OperandType.REGISTER_8BITS, OperandType.ADDRESS)
    private instrANDB_ADDRESS_WITH_REG8(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] &
                this.memoryService.loadByte(fromAddress));

        return true;

    }

    @Instruction(OpCode.ANDB_BYTE_WITH_REG8, 'ANDB', OperandType.REGISTER_8BITS, OperandType.BYTE)
    private instrAND_BYTE_WITH_REG8(toRegister: number, byte: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] & byte);

        return true;

    }

    @Instruction(OpCode.OR_REG16_WITH_REG16, 'OR', OperandType.REGISTER_16BITS, OperandType.REGISTER_16BITS)
    private instrOR_REG16_WITH_REG16(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value |
                this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.OR_REGADDRESS_WITH_REG16, 'OR', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrOR_REGADDRESS_WITH_REG16(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value |
                this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.OR_ADDRESS_WITH_REG16, 'OR', OperandType.REGISTER_16BITS, OperandType.ADDRESS)
    private instrOR_ADDRESS_WITH_REG16(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value |
                this.memoryService.loadWord(fromAddress));

        return true;

    }

    @Instruction(OpCode.OR_WORD_WITH_REG16, 'OR', OperandType.REGISTER_16BITS, OperandType.WORD)
    private instrOR_WORD_WITH_REG(toRegister: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value | word);

        return true;

    }

    @Instruction(OpCode.ORB_REG8_WITH_REG8, 'ORB', OperandType.REGISTER_8BITS, OperandType.REGISTER_8BITS)
    private instrORB_REG8_WITH_REG8(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] |
                this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;

    }

    @Instruction(OpCode.ORB_REGADDRESS_WITH_REG8, 'ORB', OperandType.REGISTER_8BITS, OperandType.REGADDRESS)
    private instrORB_REGADDRESS_WITH_REG8(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;
        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] |
                this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.ORB_ADDRESS_WITH_REG8, 'ORB', OperandType.REGISTER_8BITS, OperandType.ADDRESS)
    private instrORB_ADDRESS_WITH_REG8(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] |
                this.memoryService.loadByte(fromAddress));

        return true;

    }

    @Instruction(OpCode.ORB_BYTE_WITH_REG8, 'ORB', OperandType.REGISTER_8BITS, OperandType.BYTE)
    private instrORB_BYTE_WITH_REG8(toRegister: number, byte: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] | byte);

        return true;

    }

    @Instruction(OpCode.XOR_REG16_WITH_REG16, 'XOR', OperandType.REGISTER_16BITS, OperandType.REGISTER_16BITS)
    private instrXOR_REG16_WITH_REG16(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value ^
                this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.XOR_REGADDRESS_WITH_REG16, 'XOR', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrXOR_REGADDRESS_WITH_REG16(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value ^
                this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.XOR_ADDRESS_WITH_REG16, 'XOR', OperandType.REGISTER_16BITS, OperandType.ADDRESS)
    private instrXOR_ADDRESS_WITH_REG16(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value ^
                this.memoryService.loadWord(fromAddress));

        return true;

    }

    @Instruction(OpCode.XOR_WORD_WITH_REG16, 'XOR', OperandType.REGISTER_16BITS, OperandType.WORD)
    private instrXOR_WORD_WITH_REG16(toRegister: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value ^ word);

        return true;

    }

    @Instruction(OpCode.XORB_REG8_WITH_REG8, 'XORB', OperandType.REGISTER_8BITS, OperandType.REGISTER_8BITS)
    private instrXORB_REG8_WITH_REG8(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] ^
                this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;

    }

    @Instruction(OpCode.XORB_REGADDRESS_WITH_REG8, 'XORB', OperandType.REGISTER_8BITS, OperandType.REGADDRESS)
    private instrXORB_REGADDRESS_WITH_REG8(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;
        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] ^
                this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.XORB_ADDRESS_WITH_REG8, 'XORB', OperandType.REGISTER_8BITS, OperandType.ADDRESS)
    private instrXORB_ADDRESS_WITH_REG8(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] ^
                this.memoryService.loadByte(fromAddress));

        return true;

    }

    @Instruction(OpCode.XORB_BYTE_WITH_REG8, 'XORB', OperandType.REGISTER_8BITS, OperandType.BYTE)
    private instrXORB_BYTE_WITH_REG8(toRegister: number, byte: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] ^ byte);

        return true;

    }

    @Instruction(OpCode.NOT_REG16, 'NOT', OperandType.REGISTER_16BITS)
    private instrNOT_REG16(toRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(~this.registersBank.get(toRegister).value);

        return true;
    }

    @Instruction(OpCode.NOT_REG8, 'NOTB', OperandType.REGISTER_8BITS)
    private instrNOT_REG8(toRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check16bitOperation(~this.registersBank.get(toRegister)[byteToRegister]);

        return true;
    }

    @Instruction(OpCode.SHL_REG16_WITH_REG16, 'SHL', OperandType.REGISTER_16BITS, OperandType.REGISTER_16BITS)
    private instrSHL_REG_WITH_REG(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value <<
                this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.SHL_REGADDRESS_WITH_REG16, 'SHL', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrSHL_REGADDRESS_WITH_REG16(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value <<
                this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.SHL_ADDRESS_WITH_REG16, 'SHL', OperandType.REGISTER_16BITS, OperandType.ADDRESS)
    private instrSHL_ADDRESS_WITH_REG16(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value <<
                this.memoryService.loadWord(fromAddress));

        return true;

    }

    @Instruction(OpCode.SHL_WORD_WITH_REG16, 'SHL', OperandType.REGISTER_16BITS, OperandType.WORD)
    private instrSHL_WORD_WITH_REG16(toRegister: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value << word);

        return true;

    }

    @Instruction(OpCode.SHLB_REG8_WITH_REG8, 'SHLB', OperandType.REGISTER_8BITS, OperandType.REGISTER_8BITS)
    private instrSHLB_REG8_WITH_REG8(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] <<
                this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;

    }

    @Instruction(OpCode.SHLB_REGADDRESS_WITH_REG8, 'SHLB', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrSHLB_REGADDRESS_WITH_REG8(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;
        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] <<
                this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.SHLB_ADDRESS_WITH_REG8, 'SHLB', OperandType.REGISTER_8BITS, OperandType.ADDRESS)
    private instrSHLB_ADDRESS_WITH_REG8(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] <<
                this.memoryService.loadByte(fromAddress));

        return true;

    }

    @Instruction(OpCode.SHLB_BYTE_WITH_REG8, 'SHLB', OperandType.REGISTER_8BITS, OperandType.BYTE)
    private instrSHLB_BYTE_WITH_REG8(toRegister: number, byte: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] << byte);

        return true;

    }

    @Instruction(OpCode.SHR_REG16_WITH_REG16, 'SHR', OperandType.REGISTER_16BITS, OperandType.REGISTER_16BITS)
    private instrSHR_REG_WITH_REG16(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value >>>
                this.registersBank.get(fromRegister).value);

        return true;

    }

    @Instruction(OpCode.SHR_REGADDRESS_WITH_REG16, 'SHR', OperandType.REGISTER_16BITS, OperandType.REGADDRESS)
    private instrSHR_REGADDRESS_WITH_REG16(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value >>>
                this.memoryService.loadWord(address));

        return true;

    }

    @Instruction(OpCode.SHR_ADDRESS_WITH_REG16, 'SHR', OperandType.REGISTER_16BITS, OperandType.ADDRESS)
    private instrSHR_ADDRESS_WITH_REG16(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value >>>
                this.memoryService.loadWord(fromAddress));

        return true;

    }

    @Instruction(OpCode.SHR_WORD_WITH_REG16, 'SHR', OperandType.REGISTER_16BITS, OperandType.WORD)
    private instrSHR_WORD_WITH_REG16(toRegister: number, word: number): boolean {

        if (CPUService.is16bitsGPRorSP(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        this.registersBank.get(toRegister).value =
            this.check16bitOperation(this.registersBank.get(toRegister).value >>> word);

        return true;

    }

    @Instruction(OpCode.SHRB_REG8_WITH_REG8, 'SHRB', OperandType.REGISTER_8BITS, OperandType.REGISTER_8BITS)
    private instrSHRB_REG8_WITH_REG8(toRegister: number, fromRegister: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is8bitsGPR(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);
        const byteFromRegister = CPUService.getByteFrom8bitsGPR(fromRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] >>>
                this.registersBank.get(fromRegister)[byteFromRegister]);

        return true;

    }

    @Instruction(OpCode.SHRB_REGADDRESS_WITH_REG8, 'SHRB', OperandType.REGISTER_8BITS, OperandType.REGADDRESS)
    private instrSHRB_REGADDRESS_WITH_REG8(toRegister: number, fromRegister: number, fromOffset: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }
        if (CPUService.is16bitsGPRorSP(fromRegister) === false) {
            throw Error(`Invalid second operand: register index ${fromRegister} out of bounds`);
        }

        const address = this.registersBank.get(fromRegister).value + fromOffset;
        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] >>>
                this.memoryService.loadByte(address));

        return true;

    }

    @Instruction(OpCode.SHRB_ADDRESS_WITH_REG8, 'SHRB', OperandType.REGISTER_8BITS, OperandType.ADDRESS)
    private instrSHRB_ADDRESS_WITH_REG8(toRegister: number, fromAddress: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] >>>
                this.memoryService.loadByte(fromAddress));

        return true;

    }

    @Instruction(OpCode.SHRB_BYTE_WITH_REG8, 'SHRB', OperandType.REGISTER_8BITS, OperandType.BYTE)
    private instrSHRB_BYTE_WITH_REG8(toRegister: number, byte: number): boolean {

        if (CPUService.is8bitsGPR(toRegister) === false) {
            throw Error(`Invalid first operand: register index ${toRegister} out of bounds`);
        }

        const byteToRegister = CPUService.getByteFrom8bitsGPR(toRegister);

        this.registersBank.get(toRegister)[byteToRegister] =
            this.check8bitOperation(this.registersBank.get(toRegister)[byteToRegister] >>> byte);

        return true;

    }

    @Instruction(OpCode.CLI, 'CLI')
    private instrCLI(): boolean {

        this.SR.irqMask = 0;

        if (this.interruptInput === 1) {

            this.toInterruptHandler();

        }

        return true;

    }

    @Instruction(OpCode.STI, 'STI')
    private instrSTI(): boolean {

        this.SR.irqMask = 1;

        return true;

    }

    @Instruction(OpCode.IRET, 'IRET')
    private instrIRET(): boolean {

        this.SR.value = this.popWord();

        this.IP.value = this.popWord();

        return false;

    }

    @Instruction(OpCode.SYSCALL, 'SYSCALL')
    private instrSYSCALL(): boolean {

        if (this.SR.supervisor === 1) {
            this.SR.fault = 1;
            throw Error(`Invalid use of SYSCALL when in supervisor mode`);
        }

        this.pushWord(this.nextIP);

        this.IP.value = SYSCALL_VECTOR_ADDRESS;

        return false;

    }

    @Instruction(OpCode.SYSRET, 'SYSRET')
    private instrSYSRET(): boolean {

        if (this.SR.supervisor === 0) {
            this.SR.fault = 1;
            throw Error(`Invalid use of SYSRET when not in supervisor mode`);
        }

        this.SR.supervisor = 0;
        this.IP.value = this.popWord();

        return false;

    }

}
