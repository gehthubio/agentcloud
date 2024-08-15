import { Switch } from '@headlessui/react';
import { PencilIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import cn from 'lib/cn';
import React, { CSSProperties, forwardRef, useEffect, useState } from 'react';
import { FormFieldConfig } from 'struct/task';

interface SortableItemProps {
	id: string;
	config?: Partial<FormFieldConfig>;
	style?: CSSProperties;
	editItem: (id: string, newConfig: FormFieldConfig) => void;
	deleteItem: (id: string) => void;
}

const SortableItem = forwardRef<HTMLDivElement, SortableItemProps>(
	({ id, config, style, editItem, deleteItem, ...props }, ref) => {
		const [formConfig, setFormConfig] = useState<Partial<FormFieldConfig>>(config);

		const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement> | boolean) => {
			const isChecked = typeof e === 'boolean';
			const { name, value, type } = isChecked
				? { name: 'required', value: e, type: 'checkbox' }
				: e.target;
			const checked = isChecked ? e : (e.target as HTMLInputElement).checked;
			setFormConfig(prevConfig => {
				const newConfig = {
					...prevConfig,
					[name]: type === 'checkbox' ? checked : value
				};
				editItem(id, newConfig as FormFieldConfig);
				return newConfig;
			});
		};

		const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
			const { value } = e.target;
			setFormConfig(prevConfig => {
				const newConfig = {
					...prevConfig,
					type: value as FormFieldConfig['type']
				};
				editItem(id, newConfig as FormFieldConfig);
				return newConfig;
			});
		};

		const addOption = () => {
			setFormConfig(prevConfig => {
				const newConfig = {
					...prevConfig,
					options: [...(prevConfig?.options || []), '']
				};
				editItem(id, newConfig as FormFieldConfig);
				return newConfig;
			});
		};

		useEffect(() => {
			if (
				(formConfig?.type === 'radio' ||
					formConfig?.type === 'checkbox' ||
					formConfig?.type === 'select') &&
				(!formConfig?.options || formConfig?.options.length === 0)
			) {
				setFormConfig(prevConfig => ({
					...prevConfig,
					options: ['']
				}));
			}
		}, [formConfig?.type]);

		return (
			<div
				ref={ref}
				key={id}
				className='bg-white dark:bg-slate-800 flex flex-col gap-2 p-2 rounded-md'
				style={style}
			>
				<div className='cursor-grab flex justify-center p-1 dark:bg-gray-800' {...props}>
					<div className='grid grid-cols-3 gap-0.5'>
						<div className='w-1 h-1 bg-black dark:bg-white rounded-full'></div>
						<div className='w-1 h-1 bg-black dark:bg-white rounded-full'></div>
						<div className='w-1 h-1 bg-black dark:bg-white rounded-full'></div>
						<div className='w-1 h-1 bg-black dark:bg-white rounded-full'></div>
						<div className='w-1 h-1 bg-black dark:bg-white rounded-full'></div>
						<div className='w-1 h-1 bg-black dark:bg-white rounded-full'></div>
					</div>
				</div>
				<div className='flex w-full gap-2'>
					<input
						type='text'
						name='name'
						value={formConfig?.name}
						onChange={handleChange}
						placeholder='Field Name'
						required={formConfig?.required}
						className='block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:ring-slate-600 dark:text-white'
					/>

					<select
						name='type'
						value={formConfig?.type}
						onChange={handleTypeChange}
						className='block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:ring-slate-600 dark:text-white'
					>
						<option value='string'>Text</option>
						<option value='radio'>Radio</option>
						<option value='checkbox'>Checkboxes</option>
						<option value='select'>Multiple choice</option>
						<option value='date'>Date</option>
					</select>
				</div>
				<input
					type='text'
					name='label'
					value={formConfig?.label}
					onChange={handleChange}
					placeholder='Untitled Question'
					required={formConfig?.required}
					className='block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:ring-slate-600 dark:text-white'
				/>

				<input
					type='text'
					name='description'
					value={formConfig?.description}
					onChange={handleChange}
					placeholder='Description'
					className='block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:ring-slate-600 dark:text-white'
				/>

				{formConfig?.tooltip && (
					<input
						type='text'
						name='tooltip'
						value={formConfig?.tooltip}
						onChange={handleChange}
						placeholder='Tooltip'
						style={{ width: '100%' }}
					/>
				)}
				<div>
					{(formConfig.type === 'select' ||
						formConfig.type === 'radio' ||
						formConfig.type === 'checkbox') && (
						<>
							{formConfig?.options?.map((option, index) => (
								<div key={index} className='flex gap-2 items-center mb-2'>
									{formConfig.type === 'radio' && (
										<div className='w-4 h-4 rounded-full border border-gray-400'></div>
									)}
									{formConfig.type === 'checkbox' && (
										<div className='w-4 h-4 border border-gray-400'></div>
									)}
									{formConfig.type === 'select' && (
										<div className='w-4 h-4 flex items-center justify-center text-xs text-gray-900 dark:text-gray-50'>
											{index + 1}.
										</div>
									)}

									<input
										type='text'
										name={`option-${index}-value`}
										value={option}
										onChange={e => {
											const newOptions = [...formConfig?.options!];
											newOptions[index] = e.target.value;
											setFormConfig(prevConfig => {
												const newConfig = {
													...prevConfig,
													options: newOptions
												};
												editItem(id, newConfig as FormFieldConfig);
												return newConfig;
											});
										}}
										onKeyDown={e => {
											if (e.key === 'Enter') {
												e.preventDefault();
												const newOptions = [...formConfig?.options!, ''];
												setFormConfig(prevConfig => {
													const newConfig = {
														...prevConfig,
														options: newOptions
													};
													editItem(id, newConfig as FormFieldConfig);
													return newConfig;
												});
											}
										}}
										placeholder='Option'
										className='block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:ring-slate-600 dark:text-white'
									/>
									<XMarkIcon
										className='h-6 w-6 text-gray-400 dark:text-white cursor-pointer'
										onClick={() => {
											const newOptions = formConfig?.options?.filter((_, i) => i !== index);
											setFormConfig(prevConfig => {
												const newConfig = {
													...prevConfig,
													options: newOptions
												};
												editItem(id, newConfig as FormFieldConfig);
												return newConfig;
											});
										}}
									/>
								</div>
							))}

							<button
								type='button'
								onClick={addOption}
								className='inline-flex items-center rounded-md bg-transparent px-3 py-2 text-sm font-semibold text-white shadow-sm  focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:bg-gray-300 disabled:text-gray-700 disabled:cursor-not-allowed'
							>
								Add Option
							</button>
						</>
					)}
					<hr className='border-gray-200 dark:border-slate-400 w-full' />
					<div className='flex w-full gap-2 justify-end items-center my-2'>
						<TrashIcon
							className='h-5 w-5 text-gray-400 dark:text-white cursor-pointer'
							onClick={() => deleteItem(id)}
						/>
						<div className='inline text-gray-900 dark:text-gray-50'>Required</div>
						<Switch
							checked={formConfig?.required}
							onChange={handleChange}
							className='group inline-flex h-5 w-11 items-center rounded-full bg-gray-400 transition data-[checked]:bg-blue-600'
						>
							<span className='size-3 translate-x-1 rounded-full bg-white transition group-data-[checked]:translate-x-6' />
						</Switch>
					</div>
				</div>
			</div>
		);
	}
);

SortableItem.displayName = 'SortableItem';

export default SortableItem;
